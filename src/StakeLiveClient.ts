import { StakeSdkError, STAKE_ERROR_CATEGORY as CATEGORY, STAKE_ERROR_CODE as CODE, invalid } from './errors.js';
import { STAKE_LAUNCH_MODE, providerUrl, text } from './launch.js';
import type { StakeLiveLaunch } from './launch.js';
import { stakeAmountMicros } from './money.js';
import type { StakeAmountMicros } from './money.js';
import { ENDPOINT, parseSession, parsePlay, parseBalance, parseRoundId, fields, activeRound } from './protocol.js';
import type { StakeSession, StakeGameStateCodec, StakePlayResult, StakeActiveRound, StakeRoundId, StakeBalance } from './protocol.js';
import { Requests } from './request.js';
import type { StakeRequestOptions, StakeNetworkOptions } from './request.js';
import { SessionLease } from './sessionLease.js';
import type { StakeBrowserSessionLease } from './sessionLease.js';
import { PendingPaidDispatch } from './pendingPaidDispatch.js';
import type { Pending, StakePendingDispatchStorage } from './pendingPaidDispatch.js';
export interface StakeLiveClientOptions<T> extends StakeNetworkOptions {
  readonly launch: StakeLiveLaunch;
  readonly codec: StakeGameStateCodec<T>;
  readonly sessionLease?: StakeBrowserSessionLease;
  readonly pendingDispatchStorage?: StakePendingDispatchStorage;
}
export interface StakePlayOptions { readonly amount: StakeAmountMicros; readonly mode: string }
export type StakePaidDispatchStatus = 'READY' | 'DISPATCHING' | 'AMBIGUOUS' | 'RECONCILING' | 'CONFIRMED' | 'DESTROYED';
/** Owns a single live session and serializes operations to preserve session-scoped mutation association. */
export class StakeLiveClient<T> {
  readonly #requests: Requests;
  readonly #launch: StakeLiveLaunch;
  readonly #codec: StakeGameStateCodec<T>;
  readonly #lease: SessionLease | undefined;
  #session: StakeSession<T> | undefined;
  #operation: 'IDLE' | 'BUSY' = 'IDLE';
  readonly #pending: PendingPaidDispatch;
  #dispatchStatus: StakePaidDispatchStatus = 'READY';
  constructor(options: StakeLiveClientOptions<T>) {
    if (options.launch.kind !== STAKE_LAUNCH_MODE.LIVE) invalid('live launch');
    const sessionID = text(options.launch.sessionID, 'sessionID');
    const rgsUrl = providerUrl(options.launch.rgsUrl, true);
    if (!options.codec || typeof options.codec.parse !== 'function') invalid('codec');
    if (options.sessionLease !== undefined && options.sessionLease.kind !== 'WEB_LOCKS') invalid('session lease policy');
    this.#launch = Object.freeze({ ...options.launch, sessionID, rgsUrl });
    this.#codec = Object.freeze({ parse: options.codec.parse.bind(options.codec) });
    this.#requests = new Requests(rgsUrl, options);
    this.#lease = options.sessionLease ? new SessionLease() : undefined;
    this.#pending = new PendingPaidDispatch(options.pendingDispatchStorage, options.sessionLease !== undefined);
  }
  get session(): StakeSession<T> | undefined { return this.#session; }
  get paidDispatchStatus(): StakePaidDispatchStatus { return this.#dispatchStatus; }
  async #exclusive<R>(work: () => Promise<R>): Promise<R> {
    this.#requests.assertAlive();
    if (this.#operation === 'BUSY') throw new StakeSdkError(CATEGORY.LIFECYCLE, CODE.BUSY, 'Another operation is in progress');
    this.#operation = 'BUSY';
    try { return await work(); }
    finally { this.#operation = 'IDLE'; }
  }
  #authenticated(): StakeSession<T> {
    if (!this.#session) throw new StakeSdkError(CATEGORY.SESSION, CODE.NOT_AUTHENTICATED, 'Authenticate first');
    return this.#session;
  }
  #assertResolved(): void {
    if (this.#pending.value.kind !== 'NONE') throw new StakeSdkError(CATEGORY.AMBIGUOUS_PAID_DISPATCH,
      CODE.RECONCILIATION_REQUIRED, 'Authoritative reconciliation required');
  }
  #reconcile(session: StakeSession<T>): void {
    const round = session.round, pending = this.#pending.value;
    let resolved = false;
    switch (pending.kind) {
      case 'NONE': return;
      case 'PLAY':
        resolved = round !== null && round.betID !== pending.previous && round.amount === pending.amount && round.mode === pending.mode && round.currency === pending.currency;
        break;
      case 'EVENT': resolved = round !== null && round.betID === pending.betID && round.event === pending.event; break;
      case 'END_ROUND': resolved = round !== null && round.betID === pending.betID && !round.active; break;
    }
    if (resolved) { this.#pending.clear(); this.#dispatchStatus = 'CONFIRMED'; }
    else this.#dispatchStatus = 'AMBIGUOUS';
  }
  async #authenticate(options: StakeRequestOptions): Promise<StakeSession<T>> {
    await this.#lease?.acquire(this.#launch.rgsUrl, this.#launch.sessionID, options.signal);
    this.#requests.assertAlive();
    await this.#pending.load(this.#launch.rgsUrl, this.#launch.sessionID);
    this.#requests.assertAlive();
    const wasPending = this.#pending.value.kind !== 'NONE';
    if (wasPending) this.#dispatchStatus = 'RECONCILING';
    try {
      const session = await this.#requests.run('AUTHENTICATE', ENDPOINT.AUTH,
        JSON.stringify({ sessionID: this.#launch.sessionID }),
        input => parseSession(input, this.#codec, this.#session?.balance.currency ??
          (this.#pending.value.kind === 'PLAY' ? this.#pending.value.currency : undefined)), options);
      this.#requests.assertAlive();
      this.#reconcile(session);
      this.#session = session;
      return session;
    } catch (error) {
      if (wasPending && this.#dispatchStatus !== 'DESTROYED') this.#dispatchStatus = 'AMBIGUOUS';
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
  async #mutation<R>(pending: Pending, request: (onDispatch: () => void) => Promise<R>): Promise<R> {
    this.#assertResolved();
    try {
      const result = await request(() => {
        this.#pending.prepare(pending);
        if (pending.kind === 'PLAY') this.#dispatchStatus = 'DISPATCHING';
      });
      try { this.#pending.clear(); }
      catch (error) {
        if (error instanceof StakeSdkError && error.category === CATEGORY.LIFECYCLE) throw error;
        throw new StakeSdkError(CATEGORY.SESSION, CODE.PENDING_STORAGE_FAILURE, 'Cannot clear confirmed mutation marker', 'RESPONSE_RECEIVED');
      }
      return result;
    } catch (error) {
      if (error instanceof StakeSdkError && error.dispatch === 'NOT_DISPATCHED') {
        this.#pending.discardUndispatched();
        throw error;
      }
      if (this.#pending.value.kind !== 'NONE' && error instanceof StakeSdkError && error.category !== CATEGORY.BUSINESS_REJECTION) {
        if (this.#dispatchStatus !== 'DESTROYED') this.#dispatchStatus = 'AMBIGUOUS';
        throw new StakeSdkError(pending.kind === 'PLAY' ? CATEGORY.AMBIGUOUS_PAID_DISPATCH : error.category,
          pending.kind === 'PLAY' ? CODE.PAID_DISPATCH_UNCERTAIN : error.code,
          'Mutation outcome uncertain; reconcile before further mutations', error.dispatch, error.providerCode, error.category);
      }
      if (this.#dispatchStatus !== 'DESTROYED') this.#pending.clear();
      throw error;
    }
  }
  play(command: StakePlayOptions, options: StakeRequestOptions = {}): Promise<StakePlayResult<T>> {
    return this.#exclusive(async () => {
      this.#assertResolved();
      const session = this.#authenticated();
      if (session.round?.active) throw new StakeSdkError(CATEGORY.SESSION, CODE.ACTIVE_ROUND, 'An active round must be completed first');
      const amount = stakeAmountMicros(command.amount), mode = text(command.mode, 'play mode');
      if (!session.config.betLevels.includes(amount)) invalid('play amount outside bet levels');
      const result = await this.#mutation({ kind: 'PLAY', amount, mode, currency: session.balance.currency, previous: session.round?.betID }, onDispatch =>
        this.#requests.run('PLAY', ENDPOINT.PLAY, JSON.stringify({ sessionID: this.#launch.sessionID,
          amount, currency: session.balance.currency, mode }), input => {
            const parsed = parsePlay(input, this.#codec, session.balance.currency);
            if (parsed.round.amount !== amount || parsed.round.mode !== mode || parsed.round.betID === session.round?.betID) invalid('play round identity/economics');
            return parsed;
          }, options, onDispatch));
      this.#requests.assertAlive();
      this.#session = Object.freeze({ ...session, ...result });
      this.#dispatchStatus = 'CONFIRMED';
      return result;
    });
  }
  #round(betID: StakeRoundId): StakeSession<T> {
    this.#assertResolved();
    parseRoundId(betID);
    const session = this.#authenticated();
    if (!session.round?.active || session.round.betID !== betID) throw new StakeSdkError(CATEGORY.SESSION,
      CODE.ROUND_MISMATCH, 'Round must match authenticated active round');
    return session;
  }
  recordEvent(betID: StakeRoundId, eventValue: string, options: StakeRequestOptions = {}): Promise<string> {
    return this.#exclusive(async () => {
      const session = this.#round(betID), event = text(eventValue, 'event');
      const result = await this.#mutation({ kind: 'EVENT', betID, event }, onDispatch =>
        this.#requests.run('EVENT', ENDPOINT.EVENT, JSON.stringify({ sessionID: this.#launch.sessionID, event }),
          input => { const confirmed = text(fields(input).event, 'event response'); if (confirmed !== event) invalid('event response mismatch'); return confirmed; }, options, onDispatch));
      this.#requests.assertAlive();
      if (session.round) this.#session = Object.freeze({ ...session, round: Object.freeze({ ...session.round, event: result }) });
      return result;
    });
  }
  endRound(betID: StakeRoundId, options: StakeRequestOptions = {}): Promise<StakeBalance> {
    return this.#exclusive(async () => {
      const session = this.#round(betID);
      const result = await this.#mutation({ kind: 'END_ROUND', betID }, onDispatch =>
        this.#requests.run('END_ROUND', ENDPOINT.END, JSON.stringify({ sessionID: this.#launch.sessionID }),
          input => parseBalance(fields(input).balance, session.balance.currency), options, onDispatch));
      this.#requests.assertAlive();
      if (session.round) this.#session = Object.freeze({ ...session, balance: result, round: Object.freeze({ ...session.round, active: false }) });
      return result;
    });
  }
  destroy(): void {
    this.#dispatchStatus = 'DESTROYED';
    this.#requests.destroy();
    this.#lease?.destroy();
    this.#pending.destroy();
    this.#session = undefined;
  }
}
export function createStakeLiveClient<T>(options: StakeLiveClientOptions<T>): StakeLiveClient<T> {
  return new StakeLiveClient(options);
}
