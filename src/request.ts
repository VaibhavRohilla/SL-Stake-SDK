import { StakeSdkError, STAKE_ERROR_CATEGORY as CATEGORY, STAKE_ERROR_CODE as CODE } from './errors.js';
import { STAKE_DISPATCH_PHASE, parseProviderError, isRejectionCode } from './errors.js';
import { LIFECYCLE, INTERRUPTION, OPERATION, PROVIDER_FAILURE_KIND } from './vocabulary.js';
import { requestPath } from './wire.js';
import type { StakeEndpointRequest } from './wire.js';
import type { Operation } from './vocabulary.js';
import type { StakeDispatchPhase, StakeSdkErrorCategory, StakeSdkFailure } from './errors.js';
export interface StakeRequestOptions { readonly signal?: AbortSignal }
export const STAKE_DIAGNOSTIC_KIND = Object.freeze({ REQUEST_STARTED: 'REQUEST_STARTED', REQUEST_FINISHED: 'REQUEST_FINISHED', REQUEST_FAILED: 'REQUEST_FAILED' } as const);
export type StakeDiagnosticEvent =
  | { readonly kind: typeof STAKE_DIAGNOSTIC_KIND.REQUEST_STARTED; readonly operation: Operation }
  | { readonly kind: typeof STAKE_DIAGNOSTIC_KIND.REQUEST_FINISHED; readonly operation: Operation }
  | { readonly kind: typeof STAKE_DIAGNOSTIC_KIND.REQUEST_FAILED; readonly operation: Operation; readonly category: StakeSdkErrorCategory };
export interface StakeNetworkOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  /** Observational only. Exceptions from this callback are isolated from protocol authority. */
  readonly diagnostics?: (event: StakeDiagnosticEvent) => void;
}
export class Requests {
  #state: typeof LIFECYCLE[keyof typeof LIFECYCLE] = LIFECYCLE.ACTIVE;
  #inFlight = new Set<AbortController>();
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #diagnostics: StakeNetworkOptions['diagnostics'];
  constructor(readonly base: string, options: StakeNetworkOptions) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs <= 0 || this.#timeoutMs > 2_147_483_647) {
      throw new StakeSdkError({ category: CATEGORY.VALIDATION, code: CODE.INVALID_INPUT, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Invalid timeout');
    }
    this.#diagnostics = options.diagnostics;
  }
  assertAlive(): void {
    if (this.#state === LIFECYCLE.DESTROYED) throw new StakeSdkError({ category: CATEGORY.LIFECYCLE, code: CODE.DESTROYED, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Client destroyed');
  }
  destroy(): void {
    this.#state = LIFECYCLE.DESTROYED;
    for (const controller of this.#inFlight) controller.abort();
    this.#inFlight.clear();
  }
  #emit(event: StakeDiagnosticEvent): void {
    try { this.#diagnostics?.(Object.freeze(event)); }
    catch { /* Diagnostic consumers are observers; they cannot alter request truth. */ }
  }
  async run<T>(request: StakeEndpointRequest,
    parse: (input: unknown) => T, options: StakeRequestOptions = {}, onDispatch?: () => void): Promise<T> {
    const operation = request.operation, path = requestPath(request);
    const body = request.operation === OPERATION.REPLAY ? undefined : JSON.stringify(request.body);
    this.assertAlive();
    if (options.signal?.aborted) throw new StakeSdkError({ category: CATEGORY.ABORTED, code: CODE.REQUEST_ABORTED, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Request aborted');
    const controller = new AbortController();
    this.#inFlight.add(controller);
    let dispatch: StakeDispatchPhase = STAKE_DISPATCH_PHASE.NOT_DISPATCHED;
    let interruption: typeof INTERRUPTION[keyof typeof INTERRUPTION] = INTERRUPTION.NONE;
    const forwardAbort = (): void => { interruption = INTERRUPTION.ABORTED; controller.abort(); };
    options.signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => { interruption = INTERRUPTION.TIMEOUT; controller.abort(); }, this.#timeoutMs);
    let ownedFailure: StakeSdkError | undefined;
    const ownedError = (failure: StakeSdkFailure, message: string): StakeSdkError => {
      ownedFailure = new StakeSdkError(failure, message);
      return ownedFailure;
    };
    const interrupted = (): StakeSdkError => {
      if (this.#state === LIFECYCLE.DESTROYED) return ownedError({ category: CATEGORY.LIFECYCLE, code: CODE.DESTROYED, dispatch: dispatch }, 'Client destroyed');
      return interruption === INTERRUPTION.TIMEOUT
        ? ownedError({ category: CATEGORY.TIMEOUT, code: CODE.REQUEST_TIMEOUT, dispatch: dispatch }, 'Request timed out')
        : ownedError({ category: CATEGORY.ABORTED, code: CODE.REQUEST_ABORTED, dispatch: dispatch }, 'Request aborted');
    };
    let rejectAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(interrupted());
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    // Pre-dispatch callbacks can abort before the first race subscribes; the caller still receives interrupted().
    void abortPromise.catch(() => undefined);
    try {
      this.#emit({ kind: STAKE_DIAGNOSTIC_KIND.REQUEST_STARTED, operation });
      // Diagnostics can re-enter destroy/abort; recheck immediately before dispatch.
      if (controller.signal.aborted) throw interrupted();
      this.assertAlive();
      try { onDispatch?.(); }
      catch (error) {
        if (controller.signal.aborted) throw interrupted();
        if (error instanceof StakeSdkError && error.code === CODE.PENDING_STORAGE_FAILURE) {
          throw ownedError({ category: CATEGORY.SESSION, code: CODE.PENDING_STORAGE_FAILURE,
            dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Cannot prepare pending mutation');
        }
        throw ownedError({ category: CATEGORY.TRANSPORT, code: CODE.NETWORK_FAILURE,
          dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Request preparation failed');
      }
      if (controller.signal.aborted) throw interrupted();
      this.assertAlive();
      dispatch = STAKE_DISPATCH_PHASE.MAY_HAVE_DISPATCHED;
      // External exceptions are classified below using this request's own identity and phase.
      const response = await Promise.race([this.#fetch(`${this.base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { body, headers: { 'content-type': 'application/json' } }),
        signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
      }), abortPromise]);
      dispatch = STAKE_DISPATCH_PHASE.RESPONSE_RECEIVED;
      let json: unknown;
      let status: number;
      try {
        status = response.status;
        json = await Promise.race([response.json(), abortPromise]);
      } catch {
        throw ownedError({ category: CATEGORY.PROTOCOL, code: CODE.INVALID_JSON,
          dispatch, provider: null }, 'Response is not JSON');
      }
      if (controller.signal.aborted) throw interrupted();
      this.assertAlive();
      if (!Number.isInteger(status) || status < 100 || status > 599) throw ownedError({
        category: CATEGORY.PROTOCOL, code: CODE.INVALID_RESPONSE, dispatch, provider: null }, 'Invalid HTTP status');
      const provider = parseProviderError(json);
      if (provider !== null) {
        if (provider.kind === PROVIDER_FAILURE_KIND.KNOWN && status >= 400 && status < 500 && isRejectionCode(provider.code)) {
          throw ownedError({ category: CATEGORY.BUSINESS_REJECTION, code: CODE.PROVIDER_REJECTION, dispatch, providerCode: provider.code }, 'Provider rejected request');
        }
        throw ownedError({ category: CATEGORY.PROTOCOL,
          code: provider.kind === PROVIDER_FAILURE_KIND.MALFORMED ? CODE.INVALID_RESPONSE : CODE.HTTP_FAILURE,
          dispatch, provider }, 'Unproven provider error response');
      }
      if (status !== 200) throw ownedError({ category: CATEGORY.PROTOCOL, code: CODE.HTTP_FAILURE, dispatch: dispatch, provider: null }, 'Unexpected HTTP status');
      let result: T;
      try { result = parse(json); }
      catch (error) {
        if (error instanceof StakeSdkError) {
          const failure = error.failure;
          if (failure.category === CATEGORY.VALIDATION) {
            throw ownedError({ category: CATEGORY.VALIDATION,
              code: failure.code === CODE.CODEC_FAILURE ? CODE.CODEC_FAILURE : CODE.INVALID_RESPONSE,
              dispatch }, 'Response validation failed');
          }
          if (failure.category === CATEGORY.SESSION && failure.code === CODE.CURRENCY_CHANGED) {
            throw ownedError({ category: CATEGORY.SESSION, code: CODE.CURRENCY_CHANGED,
              dispatch }, 'Response currency changed');
          }
        }
        throw ownedError({ category: CATEGORY.VALIDATION, code: CODE.INVALID_RESPONSE, dispatch: dispatch }, 'Response validation failed');
      }
      // Codecs and diagnostics may destroy the client synchronously.
      if (controller.signal.aborted) throw interrupted();
      this.assertAlive();
      this.#emit({ kind: STAKE_DIAGNOSTIC_KIND.REQUEST_FINISHED, operation });
      if (controller.signal.aborted) throw interrupted();
      return result;
    } catch (error) {
      const failure = controller.signal.aborted ? interrupted() : error instanceof StakeSdkError && error === ownedFailure ? error
        : ownedError({ category: CATEGORY.TRANSPORT, code: CODE.NETWORK_FAILURE, dispatch: dispatch }, 'Network request failed');
      this.#emit({ kind: STAKE_DIAGNOSTIC_KIND.REQUEST_FAILED, operation, category: failure.category });
      throw failure;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', forwardAbort);
      if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
      this.#inFlight.delete(controller);
    }
  }
}
