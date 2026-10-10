import { invalid, StakeSdkError, STAKE_ERROR_CATEGORY, STAKE_ERROR_CODE, STAKE_DISPATCH_PHASE } from './errors.js';
import { stakeBetId, stakeBetMode, stakeEventId, stakeMultiplier, stakeMinimumRoundDuration } from './domain.js';
import type { StakeBetId, StakeBetMode, StakeEventId, StakeMultiplier, StakeMinimumRoundDuration, StakeSessionId } from './domain.js';
import { stakeAmountMicros, stakeCurrencyCode } from './money.js';
import type { StakeAmountMicros, StakeCurrencyCode } from './money.js';
export interface StakeGameStateCodec<TState> { parse(input: unknown): TState }
export interface StakeBalance { readonly amount: StakeAmountMicros; readonly currency: StakeCurrencyCode }
interface RoundFacts<TState> {
  readonly betID: StakeBetId;
  readonly currency: StakeCurrencyCode;
  readonly mode: StakeBetMode;
  readonly state: TState;
  /** Missing or explicit null on wire means no supplied checkpoint. */
  readonly event: StakeEventId | null;
  /** Null means the provider did not supply this fact; never inferred from another field. */
  readonly payout: StakeAmountMicros | null;
  readonly payoutMultiplier: StakeMultiplier | null;
  readonly costMultiplier: StakeMultiplier | null;
}
export interface StakeActiveRound<TState> extends RoundFacts<TState> {
  readonly active: true;
  readonly amount: StakeAmountMicros;
}
export interface StakeCompletedRound<TState> extends RoundFacts<TState> {
  readonly active: false;
  /** Completed authenticate rounds may omit amount; absence is not reconciliation evidence. */
  readonly amount: StakeAmountMicros | null;
}
export type StakeRound<TState> = StakeActiveRound<TState> | StakeCompletedRound<TState>;
export interface StakeJurisdiction {
  readonly socialCasino: boolean;
  readonly disabledFullscreen: boolean;
  readonly disabledTurbo: boolean;
  readonly disabledSuperTurbo: boolean;
  readonly disabledAutoplay: boolean;
  readonly disabledSlamstop: boolean;
  readonly disabledSpacebar: boolean;
  readonly disabledBuyFeature: boolean;
  readonly displayNetPosition: boolean;
  readonly displayRTP: boolean;
  readonly displaySessionTimer: boolean;
  readonly minimumRoundDuration: StakeMinimumRoundDuration;
}
export interface StakeBetConfig {
  readonly minBet: StakeAmountMicros; readonly maxBet: StakeAmountMicros;
  readonly stepBet: StakeAmountMicros; readonly defaultBetAmount: StakeAmountMicros;
  readonly betLevels: readonly StakeAmountMicros[];
}
export interface StakeSession<TState> {
  readonly id: StakeSessionId;
  readonly balance: StakeBalance;
  readonly config: StakeBetConfig;
  readonly jurisdiction: StakeJurisdiction;
  readonly round: StakeRound<TState> | null;
}
export interface StakePlayInput { readonly amount: StakeAmountMicros; readonly mode: StakeBetMode }
/** A new play response must identify its requested amount even if RGS auto-completed it. */
export type StakePlayedRound<TState> = StakeActiveRound<TState> | (StakeCompletedRound<TState> & { readonly amount: StakeAmountMicros });
export interface StakePlayResult<TState> { readonly balance: StakeBalance; readonly round: StakePlayedRound<TState> }
export interface StakeReplayResult<TState> {
  readonly state: TState; readonly payoutMultiplier: StakeMultiplier; readonly costMultiplier: StakeMultiplier;
}
// Local bags narrow untrusted wire/storage objects only; they never enter domain state.
export function fields(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalid('response object');
  return input as Record<string, unknown>;
}
export function parseBalance(input: unknown, expected?: StakeCurrencyCode): StakeBalance {
  const value = fields(input);
  const currency = stakeCurrencyCode(value.currency);
  if (expected !== undefined && currency !== expected) throw new StakeSdkError({
    category: STAKE_ERROR_CATEGORY.SESSION, code: STAKE_ERROR_CODE.CURRENCY_CHANGED,
    dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Authenticated currency changed');
  return Object.freeze({ amount: stakeAmountMicros(value.amount), currency });
}
/** Validate before clone: structuredClone would erase a class prototype and conceal unsupported state. */
function validateState(input: unknown, ancestors = new WeakSet<object>(), freeze = false): void {
  if (input === null || typeof input === 'boolean' || typeof input === 'string') return;
  if (typeof input === 'number') { if (!Number.isFinite(input)) invalid('codec finite number'); return; }
  if (typeof input !== 'object') invalid('codec plain data');
  if (ancestors.has(input)) invalid('codec cyclic state');
  const array = Array.isArray(input);
  const prototype: unknown = Object.getPrototypeOf(input);
  if (!array && prototype !== Object.prototype && prototype !== null) invalid('codec plain object');
  if (Object.getOwnPropertySymbols(input).length) invalid('codec symbol property');
  ancestors.add(input);
  const keys = Object.getOwnPropertyNames(input);
  if (array && (keys.length !== input.length + 1 || !keys.every(key => key === 'length' || /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < input.length))) invalid('codec sparse or decorated array');
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid('codec accessor or hidden property');
    const child: unknown = descriptor.value;
    validateState(child, ancestors, freeze);
  }
  ancestors.delete(input);
  if (freeze) Object.freeze(input);
}
function gameState<T>(input: unknown, codec: StakeGameStateCodec<T>): T {
  if (input === undefined) invalid('game state');
  try {
    const state = codec.parse(input);
    validateState(state);
    const copied = structuredClone(state);
    validateState(copied, new WeakSet(), true);
    return copied;
  } catch {
    throw new StakeSdkError({ category: STAKE_ERROR_CATEGORY.VALIDATION, code: STAKE_ERROR_CODE.CODEC_FAILURE,
      dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Game state codec failed');
  }
}
export function parseRound<T>(input: unknown, currency: StakeCurrencyCode, codec: StakeGameStateCodec<T>): StakeRound<T> {
  const value = fields(input);
  if (typeof value.active !== 'boolean') invalid('round.active');
  if (value.currency !== undefined && stakeCurrencyCode(value.currency) !== currency) invalid('round.currency');
  const facts: RoundFacts<T> = {
    betID: stakeBetId(value.betID), currency, mode: stakeBetMode(value.mode), state: gameState(value.state, codec),
    event: value.event === undefined || value.event === null ? null : stakeEventId(value.event),
    payout: value.payout === undefined ? null : stakeAmountMicros(value.payout),
    payoutMultiplier: value.payoutMultiplier === undefined ? null : stakeMultiplier(value.payoutMultiplier),
    costMultiplier: value.costMultiplier === undefined ? null : stakeMultiplier(value.costMultiplier),
  };
  return value.active
    ? Object.freeze({ ...facts, active: true, amount: stakeAmountMicros(value.amount) })
    : Object.freeze({ ...facts, active: false, amount: value.amount === undefined ? null : stakeAmountMicros(value.amount) });
}
function boolean(input: unknown): boolean {
  if (typeof input !== 'boolean') invalid('jurisdiction boolean');
  return input;
}
export function parseJurisdiction(input: unknown): StakeJurisdiction {
  const value = fields(input);
  return Object.freeze({
    socialCasino: boolean(value.socialCasino), disabledFullscreen: boolean(value.disabledFullscreen),
    disabledTurbo: boolean(value.disabledTurbo), disabledSuperTurbo: boolean(value.disabledSuperTurbo),
    disabledAutoplay: boolean(value.disabledAutoplay), disabledSlamstop: boolean(value.disabledSlamstop),
    disabledSpacebar: boolean(value.disabledSpacebar), disabledBuyFeature: boolean(value.disabledBuyFeature),
    displayNetPosition: boolean(value.displayNetPosition), displayRTP: boolean(value.displayRTP),
    displaySessionTimer: boolean(value.displaySessionTimer), minimumRoundDuration: stakeMinimumRoundDuration(value.minimumRoundDuration),
  });
}
export function parseAuthenticateResponse<T>(input: unknown, codec: StakeGameStateCodec<T>, id: StakeSessionId, expected?: StakeCurrencyCode): StakeSession<T> {
  const value = fields(input);
  const balance = parseBalance(value.balance, expected);
  const config = fields(value.config);
  const minBet = stakeAmountMicros(config.minBet), maxBet = stakeAmountMicros(config.maxBet);
  const stepBet = stakeAmountMicros(config.stepBet), defaultBetAmount = stakeAmountMicros(config.defaultBetLevel);
  if (!Array.isArray(config.betLevels) || !config.betLevels.length || minBet === 0 || maxBet < minBet || stepBet === 0) invalid('bet config');
  const levels: unknown[] = config.betLevels;
  const betLevels = Object.freeze(levels.map(stakeAmountMicros));
  if (new Set(betLevels).size !== betLevels.length || betLevels.some(amount => amount < minBet || amount > maxBet) || !betLevels.includes(defaultBetAmount)) invalid('bet levels/default amount');
  if (!Object.hasOwn(value, 'round')) invalid('authenticate.round');
  const round = value.round === null ? null : parseRound(value.round, balance.currency, codec);
  return Object.freeze({ id, balance, config: Object.freeze({ minBet, maxBet, stepBet, defaultBetAmount, betLevels }),
    jurisdiction: parseJurisdiction(config.jurisdiction), round });
}
export function parsePlayResponse<T>(input: unknown, codec: StakeGameStateCodec<T>, currency: StakeCurrencyCode): StakePlayResult<T> {
  const value = fields(input), balance = parseBalance(value.balance, currency);
  const round = parseRound(value.round, currency, codec);
  if (round.amount === null) invalid('play round amount');
  return Object.freeze({ balance, round: round.active ? round : Object.freeze({ ...round, amount: round.amount }) });
}
export function parseEventResponse(input: unknown, expected: StakeEventId): StakeEventId {
  const event = stakeEventId(fields(input).event);
  if (event !== expected) invalid('event response mismatch');
  return event;
}
export function parseEndRoundResponse(input: unknown, currency: StakeCurrencyCode): StakeBalance {
  return parseBalance(fields(input).balance, currency);
}
export function parseReplayResponse<T>(input: unknown, codec: StakeGameStateCodec<T>): StakeReplayResult<T> {
  const value = fields(input);
  return Object.freeze({ payoutMultiplier: stakeMultiplier(value.payoutMultiplier), costMultiplier: stakeMultiplier(value.costMultiplier), state: gameState(value.state, codec) });
}
export function activeRound<T>(session: StakeSession<T>): StakeActiveRound<T> | null {
  const round = session.round;
  return round?.active === true ? round : null;
}
export const ENDPOINT = Object.freeze({ AUTH: '/wallet/authenticate', PLAY: '/wallet/play', EVENT: '/bet/event', END: '/wallet/end-round', REPLAY: '/bet/replay' } as const);
