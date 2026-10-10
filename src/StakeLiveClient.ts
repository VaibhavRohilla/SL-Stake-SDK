import { StakeSdkError, STAKE_ERROR_CATEGORY as CATEGORY, STAKE_ERROR_CODE as CODE, STAKE_DISPATCH_PHASE, invalid } from './errors.js';
import { STAKE_LAUNCH_MODE, providerUrl } from './launch.js';
import type { StakeLiveLaunch } from './launch.js';
import { stakeSessionId, stakeBetId, stakeBetMode, stakeEventId, stakeLanguage, stakeDevice } from './domain.js';
import type { StakeBetId, StakeEventId } from './domain.js';
import { MUTATION, SERIALIZATION, OPERATION } from './vocabulary.js';
import { STAKE_SESSION_LEASE_POLICY } from './sessionLease.js';
import { stakeAmountMicros } from './money.js';
import { parseAuthenticateResponse, parsePlayResponse, parseEventResponse, parseEndRoundResponse, activeRound } from './protocol.js';
import type { StakeSession, StakeGameStateCodec, StakePlayResult, StakeActiveRound, StakeBalance, StakePlayInput } from './protocol.js';
import { Requests } from './request.js';
import type { StakeRequestOptions, StakeNetworkOptions } from './request.js';
import { SessionLease } from './sessionLease.js';
import type { StakeSessionLeasePolicy } from './sessionLease.js';
import { PendingPaidDispatch } from './pendingPaidDispatch.js';
import type { StakePendingMutation, StakePendingDispatchStorage } from './pendingPaidDispatch.js';
export interface StakeLiveClientOptions<T> extends StakeNetworkOptions {
  readonly launch: StakeLiveLaunch;
  readonly codec: StakeGameStateCodec<T>;
  readonly sessionLease?: StakeSessionLeasePolicy;
  readonly pendingDispatchStorage?: StakePendingDispatchStorage;
}
export const STAKE_PAID_DISPATCH_STATUS = Object.freeze({ READY: 'READY', DISPATCHING: 'DISPATCHING', AMBIGUOUS: 'AMBIGUOUS', RECONCILING: 'RECONCILING', CONFIRMED: 'CONFIRMED', DESTROYED: 'DESTROYED' } as const);
export type StakePaidDispatchStatus = typeof STAKE_PAID_DISPATCH_STATUS[keyof typeof STAKE_PAID_DISPATCH_STATUS];
/** Owns a single live session and serializes operations to preserve session-scoped mutation association. */
export class StakeLiveClient<T> {
  readonly #requests: Requests;
  readonly #launch: StakeLiveLaunch;
  readonly #codec: StakeGameStateCodec<T>;
  readonly #lease: SessionLease | undefined;
  #session: StakeSession<T> | undefined;
  #operation: typeof SERIALIZATION[keyof typeof SERIALIZATION] = SERIALIZATION.IDLE;
  readonly #pending: PendingPaidDispatch;
  #dispatchStatus: StakePaidDispatchStatus = STAKE_PAID_DISPATCH_STATUS.READY;
  constructor(options: StakeLiveClientOptions<T>) {
    if (options.launch.kind !== STAKE_LAUNCH_MODE.LIVE) invalid('live launch');
    const sessionID = stakeSessionId(options.launch.sessionID);
    const rgsUrl = providerUrl(options.launch.rgsUrl, true);
    if (!options.codec || typeof options.codec.parse !== 'function') invalid('codec');
    if (options.sessionLease !== undefined && options.sessionLease.kind !== STAKE_SESSION_LEASE_POLICY.WEB_LOCKS && options.sessionLease.kind !== STAKE_SESSION_LEASE_POLICY.NONE) invalid('session lease policy');
    this.#launch = Object.freeze({ kind: STAKE_LAUNCH_MODE.LIVE, sessionID, rgsUrl, lang: stakeLanguage(options.launch.lang), device: stakeDevice(options.launch.device), social: options.launch.social });
    if (typeof options.launch.social !== 'boolean') invalid('social');
    this.#codec = Object.freeze({ parse: options.codec.parse.bind(options.codec) });
    this.#requests = new Requests(rgsUrl, options);
    this.#lease = options.sessionLease?.kind === STAKE_SESSION_LEASE_POLICY.WEB_LOCKS ? new SessionLease() : undefined;
    this.#pending = new PendingPaidDispatch(options.pendingDispatchStorage, this.#lease !== undefined);
  }
  get session(): StakeSession<T> | undefined { return this.#session; }
  get paidDispatchStatus(): StakePaidDispatchStatus { return this.#dispatchStatus; }
  async #exclusive<R>(work: () => Promise<R>): Promise<R> {
    this.#requests.assertAlive();
    if (this.#operation === SERIALIZATION.BUSY) throw new StakeSdkError({ category: CATEGORY.LIFECYCLE, code: CODE.BUSY, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Another operation is in progress');
    this.#operation = SERIALIZATION.BUSY;
    try { return await work(); }
    finally { this.#operation = SERIALIZATION.IDLE; }
  }
  #authenticated(): StakeSession<T> {
    if (!this.#session) throw new StakeSdkError({ category: CATEGORY.SESSION, code: CODE.NOT_AUTHENTICATED, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Authenticate first');
    return this.#session;
  }
  #assertResolved(): void {
    const pending = this.#pending.value;
    if (pending.kind !== MUTATION.NONE) throw new StakeSdkError({ category: CATEGORY.AMBIGUOUS_PAID_DISPATCH,
      code: CODE.RECONCILIATION_REQUIRED, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED, pending }, 'Authoritative reconciliation required');
  }
  #reconcile(session: StakeSession<T>): void {
    const round = session.round, pending = this.#pending.value;
    let resolved = false;
    switch (pending.kind) {
      case MUTATION.NONE: return;
      case MUTATION.PLAY:
        resolved = round !== null && round.betID !== pending.previous && round.amount === pending.amount && round.mode === pending.mode && round.currency === pending.currency;
        break;
      case MUTATION.EVENT: resolved = round !== null && round.betID === pending.betID && round.event === pending.event; break;
      case MUTATION.END_ROUND: resolved = round !== null && round.betID === pending.betID && !round.active; break;
    }
    if (resolved) { this.#pending.clear(); this.#requests.assertAlive(); this.#dispatchStatus = STAKE_PAID_DISPATCH_STATUS.CONFIRMED; }
    else this.#dispatchStatus = STAKE_PAID_DISPATCH_STATUS.AMBIGUOUS;
  }
  async #authenticate(options: StakeRequestOptions): Promise<StakeSession<T>> {
    await this.#lease?.acquire(this.#launch.rgsUrl, this.#launch.sessionID, options.signal);
    this.#requests.assertAlive();
    await this.#pending.load(this.#launch.rgsUrl, this.#launch.sessionID);
    this.#requests.assertAlive();
    const wasPending = this.#pending.value.kind !== MUTATION.NONE;
    if (wasPending) this.#dispatchStatus = STAKE_PAID_DISPATCH_STATUS.RECONCILING;
    try {
      const session = await this.#requests.run({ operation: OPERATION.AUTHENTICATE, body: { sessionID: this.#launch.sessionID, language: this.#launch.lang } },
        input => parseAuthenticateResponse(input, this.#codec, this.#launch.sessionID, this.#session?.balance.currency ??
          (this.#pending.value.kind === MUTATION.PLAY ? this.#pending.value.currency : undefined)), options);
      this.#requests.assertAlive();
      this.#reconcile(session);
      this.#requests.assertAlive();
      this.#session = session;
      return session;
    } catch (error) {
      if (wasPending && this.#dispatchStatus !== STAKE_PAID_DISPATCH_STATUS.DESTROYED) this.#dispatchStatus = STAKE_PAID_DISPATCH_STATUS.AMBIGUOUS;
      throw error;
    }
  }
  authenticate(options: StakeRequestOptions = {}): Promise<StakeSession<T>> {
    return this.#exclusive(() => this.#authenticate(options));
  }
  /** Refreshes /wallet/authenticate; there is no invented active-round endpoint. Null is not proof a missing paid dispatch failed. */
  getActiveRound(options: StakeRequestOptions = {}): Promise<StakeActiveRound<T> | null> {
    return this.#exclusive(async () => activeRound(await this.#authenticate(options)));
  }
  #clearProvenMutation(): void {
    try { this.#pending.clear(); }
    catch {
      const destroyed = this.#dispatchStatus === STAKE_PAID_DISPATCH_STATUS.DESTROYED;
      throw destroyed
        ? new StakeSdkError({ category: CATEGORY.LIFECYCLE, code: CODE.DESTROYED,
            dispatch: STAKE_DISPATCH_PHASE.RESPONSE_RECEIVED }, 'Client destroyed')
        : new StakeSdkError({ category: CATEGORY.SESSION, code: CODE.PENDING_STORAGE_FAILURE,
            dispatch: STAKE_DISPATCH_PHASE.RESPONSE_RECEIVED }, 'Cannot clear proven mutation marker');
    }
  }
  async #mutation<R>(pending: StakePendingMutation, request: (onDispatch: () => void) => Promise<R>): Promise<R> {
    this.#assertResolved();
    const resolvedStatus = this.#dispatchStatus;
    try {
      let result: R;
      try {
        result = await request(() => {
          this.#pending.prepare(pending);
          if (pending.kind === MUTATION.PLAY) this.#dispatchStatus = STAKE_PAID_DISPATCH_STATUS.DISPATCHING;
        });
      } catch (error) {
        if (error instanceof StakeSdkError && error.category === CATEGORY.BUSINESS_REJECTION) this.#clearProvenMutation();
        throw error;
      }
      this.#clearProvenMutation();
      return result;
    } catch (error) {
      if (error instanceof StakeSdkError && error.dispatch === STAKE_DISPATCH_PHASE.NOT_DISPATCHED) {
        this.#pending.discardUndispatched();
        if (this.#dispatchStatus !== STAKE_PAID_DISPATCH_STATUS.DESTROYED) this.#dispatchStatus = resolvedStatus;
        throw error;
      }
      if (this.#pending.value.kind !== MUTATION.NONE && error instanceof StakeSdkError &&
          error.failure.category !== CATEGORY.BUSINESS_REJECTION && error.failure.category !== CATEGORY.AMBIGUOUS_PAID_DISPATCH) {
        if (this.#dispatchStatus !== STAKE_PAID_DISPATCH_STATUS.DESTROYED) this.#dispatchStatus = STAKE_PAID_DISPATCH_STATUS.AMBIGUOUS;
        const reason = error.failure;
        if (pending.kind === MUTATION.PLAY && reason.dispatch !== STAKE_DISPATCH_PHASE.NOT_DISPATCHED) {
          throw new StakeSdkError({ category: CATEGORY.AMBIGUOUS_PAID_DISPATCH, code: CODE.PAID_DISPATCH_UNCERTAIN,
            dispatch: reason.dispatch, reason, pending }, 'Mutation outcome uncertain; reconcile before further mutations');
        }
        throw error;
      }
      if (this.#dispatchStatus !== STAKE_PAID_DISPATCH_STATUS.DESTROYED) {
        this.#dispatchStatus = resolvedStatus;
      }
      throw error;
    }
  }
  play(command: StakePlayInput, options: StakeRequestOptions = {}): Promise<StakePlayResult<T>> {
    return this.#exclusive(async () => {
      this.#assertResolved();
      const session = this.#authenticated();
      if (session.round?.active) throw new StakeSdkError({ category: CATEGORY.SESSION, code: CODE.ACTIVE_ROUND, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'An active round must be completed first');
      const amount = stakeAmountMicros(command.amount), mode = stakeBetMode(command.mode);
      if (!session.config.betLevels.includes(amount)) invalid('play amount outside bet levels');
      const result = await this.#mutation({ kind: MUTATION.PLAY, amount, mode, currency: session.balance.currency, previous: session.round?.betID ?? null }, onDispatch =>
        this.#requests.run({ operation: OPERATION.PLAY, body: { sessionID: this.#launch.sessionID,
          amount, currency: session.balance.currency, mode } }, input => {
            const parsed = parsePlayResponse(input, this.#codec, session.balance.currency);
            if (parsed.round.amount !== amount || parsed.round.mode !== mode || parsed.round.betID === session.round?.betID) invalid('play round identity/economics');
            return parsed;
          }, options, onDispatch));
      this.#requests.assertAlive();
      this.#session = Object.freeze({ ...session, ...result });
      this.#dispatchStatus = STAKE_PAID_DISPATCH_STATUS.CONFIRMED;
      return result;
    });
  }
  #round(betID: StakeBetId): StakeSession<T> {
    this.#assertResolved();
    stakeBetId(betID);
    const session = this.#authenticated();
    if (!session.round?.active || session.round.betID !== betID) throw new StakeSdkError({ category: CATEGORY.SESSION, code: CODE.ROUND_MISMATCH, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Round must match authenticated active round');
    return session;
  }
  recordEvent(betID: StakeBetId, eventValue: StakeEventId, options: StakeRequestOptions = {}): Promise<StakeEventId> {
    return this.#exclusive(async () => {
      const session = this.#round(betID), event = stakeEventId(eventValue);
      const result = await this.#mutation({ kind: MUTATION.EVENT, betID, event }, onDispatch =>
        this.#requests.run({ operation: OPERATION.EVENT, body: { sessionID: this.#launch.sessionID, event } },
          input => parseEventResponse(input, event), options, onDispatch));
      this.#requests.assertAlive();
      if (session.round) this.#session = Object.freeze({ ...session, round: Object.freeze({ ...session.round, event: result }) });
      return result;
    });
  }
  endRound(betID: StakeBetId, options: StakeRequestOptions = {}): Promise<StakeBalance> {
    return this.#exclusive(async () => {
      const session = this.#round(betID);
      const result = await this.#mutation({ kind: MUTATION.END_ROUND, betID }, onDispatch =>
        this.#requests.run({ operation: OPERATION.END_ROUND, body: { sessionID: this.#launch.sessionID } },
          input => parseEndRoundResponse(input, session.balance.currency), options, onDispatch));
      this.#requests.assertAlive();
      if (session.round) this.#session = Object.freeze({ ...session, balance: result, round: Object.freeze({ ...session.round, active: false as const }) });
      return result;
    });
  }
  destroy(): void {
    this.#dispatchStatus = STAKE_PAID_DISPATCH_STATUS.DESTROYED;
    this.#requests.destroy();
    this.#lease?.destroy();
    this.#pending.destroy();
    this.#session = undefined;
  }
}
export function createStakeLiveClient<T>(options: StakeLiveClientOptions<T>): StakeLiveClient<T> {
  return new StakeLiveClient(options);
}
