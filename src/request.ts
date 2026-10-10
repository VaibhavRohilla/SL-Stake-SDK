import { StakeSdkError, STAKE_ERROR_CATEGORY as CATEGORY, STAKE_ERROR_CODE as CODE } from './errors.js';
import type { StakeDispatchState, StakeSdkErrorCategory } from './errors.js';
export interface StakeRequestOptions { readonly signal?: AbortSignal }
export interface StakeDiagnostic {
  readonly kind: 'REQUEST_STARTED' | 'REQUEST_FINISHED' | 'REQUEST_FAILED';
  readonly operation: 'AUTHENTICATE' | 'PLAY' | 'EVENT' | 'END_ROUND' | 'REPLAY';
  readonly category?: StakeSdkErrorCategory;
}
export interface StakeNetworkOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  /** Observational only. Exceptions from this callback are isolated from protocol authority. */
  readonly diagnostics?: (event: StakeDiagnostic) => void;
}
const REJECTION_CODES = new Set(['ERR_VAL', 'ERR_IPB', 'ERR_IS', 'ERR_ATE', 'ERR_GLE', 'ERR_LOC']);
export class Requests {
  #state: 'ALIVE' | 'DESTROYED' = 'ALIVE';
  #inFlight = new Set<AbortController>();
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #diagnostics: StakeNetworkOptions['diagnostics'];
  constructor(readonly base: string, options: StakeNetworkOptions) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs <= 0 || this.#timeoutMs > 2_147_483_647) {
      throw new StakeSdkError(CATEGORY.VALIDATION, CODE.INVALID_INPUT, 'Invalid timeout');
    }
    this.#diagnostics = options.diagnostics;
  }
  assertAlive(): void {
    if (this.#state === 'DESTROYED') throw new StakeSdkError(CATEGORY.LIFECYCLE, CODE.DESTROYED, 'Client destroyed');
  }
  destroy(): void {
    this.#state = 'DESTROYED';
    for (const controller of this.#inFlight) controller.abort();
    this.#inFlight.clear();
  }
  #emit(event: StakeDiagnostic): void {
    try { this.#diagnostics?.(Object.freeze(event)); }
    catch { /* Diagnostic consumers are observers; they cannot alter request truth. */ }
  }
  async run<T>(operation: StakeDiagnostic['operation'], path: string, body: string | undefined,
    parse: (input: unknown) => T, options: StakeRequestOptions = {}, onDispatch?: () => void): Promise<T> {
    this.assertAlive();
    if (options.signal?.aborted) throw new StakeSdkError(CATEGORY.ABORTED, CODE.REQUEST_ABORTED, 'Request aborted');
    const controller = new AbortController();
    this.#inFlight.add(controller);
    let dispatch: StakeDispatchState = 'NOT_DISPATCHED';
    let interruption: 'NONE' | 'ABORTED' | 'TIMEOUT' = 'NONE';
    const forwardAbort = (): void => { interruption = 'ABORTED'; controller.abort(); };
    options.signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => { interruption = 'TIMEOUT'; controller.abort(); }, this.#timeoutMs);
    const interrupted = (): StakeSdkError => {
      if (this.#state === 'DESTROYED') return new StakeSdkError(CATEGORY.LIFECYCLE, CODE.DESTROYED, 'Client destroyed', dispatch);
      return interruption === 'TIMEOUT'
        ? new StakeSdkError(CATEGORY.TIMEOUT, CODE.REQUEST_TIMEOUT, 'Request timed out', dispatch)
        : new StakeSdkError(CATEGORY.ABORTED, CODE.REQUEST_ABORTED, 'Request aborted', dispatch);
    };
    let rejectAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(interrupted());
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    // Pre-dispatch callbacks can abort before the first race subscribes; the caller still receives interrupted().
    void abortPromise.catch(() => undefined);
    try {
      this.#emit({ kind: 'REQUEST_STARTED', operation });
      // Diagnostics can re-enter destroy/abort; recheck immediately before dispatch.
      if (controller.signal.aborted) throw interrupted();
      this.assertAlive();
      onDispatch?.();
      if (controller.signal.aborted) throw interrupted();
      this.assertAlive();
      dispatch = 'MAY_HAVE_DISPATCHED';
      const response = await Promise.race([this.#fetch(`${this.base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { body, headers: { 'content-type': 'application/json' } }),
        signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
      }), abortPromise]);
      dispatch = 'RESPONSE_RECEIVED';
      const json: unknown = await Promise.race([response.json().catch(() => {
        throw new StakeSdkError(CATEGORY.PROTOCOL, CODE.INVALID_JSON, 'Response is not JSON', dispatch);
      }), abortPromise]);
      if (controller.signal.aborted) throw interrupted();
      this.assertAlive();
      if (json !== null && typeof json === 'object' && 'error' in json) {
        const raw = json.error;
        if (typeof raw !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(raw)) {
          throw new StakeSdkError(CATEGORY.PROTOCOL, CODE.INVALID_RESPONSE, 'Invalid provider error envelope', dispatch);
        }
        const definite = response.status >= 400 && response.status < 500 && REJECTION_CODES.has(raw);
        throw new StakeSdkError(definite ? CATEGORY.BUSINESS_REJECTION : CATEGORY.PROTOCOL,
          definite ? CODE.PROVIDER_REJECTION : CODE.HTTP_FAILURE, 'Provider rejected request', dispatch, raw);
      }
      if (response.status !== 200) throw new StakeSdkError(CATEGORY.PROTOCOL, CODE.HTTP_FAILURE, 'Unexpected HTTP status', dispatch);
      let result: T;
      try { result = parse(json); }
      catch (error) {
        if (error instanceof StakeSdkError) throw new StakeSdkError(error.category,
          error.code === CODE.INVALID_INPUT ? CODE.INVALID_RESPONSE : error.code,
          'Response validation failed', dispatch, error.providerCode);
        throw new StakeSdkError(CATEGORY.VALIDATION, CODE.INVALID_RESPONSE, 'Response validation failed', dispatch);
      }
      // Codecs and diagnostics may destroy the client synchronously.
      if (controller.signal.aborted) throw interrupted();
      this.assertAlive();
      this.#emit({ kind: 'REQUEST_FINISHED', operation });
      if (controller.signal.aborted) throw interrupted();
      return result;
    } catch (error) {
      const failure = controller.signal.aborted ? interrupted() : error instanceof StakeSdkError ? error
        : new StakeSdkError(CATEGORY.TRANSPORT, CODE.NETWORK_FAILURE, 'Network request failed', dispatch);
      this.#emit({ kind: 'REQUEST_FAILED', operation, category: failure.category });
      throw failure;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', forwardAbort);
      if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
      this.#inFlight.delete(controller);
    }
  }
}
