import { invalid, StakeSdkError, STAKE_ERROR_CATEGORY, STAKE_ERROR_CODE, STAKE_DISPATCH_PHASE } from './errors.js';
import { stakeBetId, stakeBetMode, stakeEventId, stakeMultiplier, stakeMinimumRoundDuration } from './domain.js';
import type { StakeBetId, StakeBetMode, StakeEventId, StakeMultiplier, StakeMinimumRoundDuration, StakeSessionId } from './domain.js';
import { stakeAmountMicros, stakeCurrencyCode } from './money.js';
import type { StakeAmountMicros, StakeCurrencyCode } from './money.js';
/** Published codec data is recursively immutable, including arrays and tuples. */
export type StakeReadonlyState<T> = T extends object ? { readonly [K in keyof T]: StakeReadonlyState<T[K]> } : T;
export interface StakeGameStateCodec<TState> { parse(input: unknown): TState }
export interface StakeBalance { readonly amount: StakeAmountMicros; readonly currency: StakeCurrencyCode }
interface RoundFacts<TState> {
  readonly betID: StakeBetId;
  readonly currency: StakeCurrencyCode;
  readonly mode: StakeBetMode;
  readonly state: StakeReadonlyState<TState>;
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
  readonly state: StakeReadonlyState<TState>; readonly payoutMultiplier: StakeMultiplier; readonly costMultiplier: StakeMultiplier;
}
// Read only boundary data properties; raw objects and record bags never leave a parser.
function field(input: unknown, key: string): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalid('response object');
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor && !Object.hasOwn(descriptor, 'value')) invalid('response data property');
  const value: unknown = descriptor?.value;
  return value;
}
export function parseBalance(input: unknown, expected?: StakeCurrencyCode): StakeBalance {
  const currency = stakeCurrencyCode(field(input, 'currency'));
  if (expected !== undefined && currency !== expected) throw new StakeSdkError({
    category: STAKE_ERROR_CATEGORY.SESSION, code: STAKE_ERROR_CODE.CURRENCY_CHANGED,
    dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Authenticated currency changed');
  return Object.freeze({ amount: stakeAmountMicros(field(input, 'amount')), currency });
}
/** Validate before clone: structuredClone would erase a class prototype and conceal unsupported state. */
function validateState(input: unknown, ancestors = new WeakSet<object>(), freeze = false): void {
  if (input === null || typeof input === 'boolean' || typeof input === 'string') return;
  if (typeof input === 'number') { if (!Number.isFinite(input)) invalid('codec finite number'); return; }
  if (typeof input !== 'object') invalid('codec plain data');
  if (ancestors.has(input)) invalid('codec cyclic state');
  const array = Array.isArray(input);
  const prototype: unknown = Object.getPrototypeOf(input);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalid('codec plain data prototype');
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
function gameState<T>(input: unknown, codec: StakeGameStateCodec<T>): StakeReadonlyState<T> {
  if (input === undefined) invalid('game state');
  try {
    const state = codec.parse(input);
    validateState(state);
    const copied = structuredClone(state);
    validateState(copied, new WeakSet(), true);
    // The complete validated clone has been recursively frozen above.
    return copied as StakeReadonlyState<T>;
  } catch {
    throw new StakeSdkError({ category: STAKE_ERROR_CATEGORY.VALIDATION, code: STAKE_ERROR_CODE.CODEC_FAILURE,
      dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Game state codec failed');
  }
}
export function parseRound<T>(input: unknown, currency: StakeCurrencyCode, codec: StakeGameStateCodec<T>): StakeRound<T> {
  // Snapshot and validate every provider fact before the codec can re-enter caller code.
  const active = boolean(field(input, 'active'));
  const suppliedCurrency = field(input, 'currency');
  if (suppliedCurrency !== undefined && stakeCurrencyCode(suppliedCurrency) !== currency) invalid('round.currency');
  const betID = stakeBetId(field(input, 'betID')), mode = stakeBetMode(field(input, 'mode'));
  const checkpoint = field(input, 'event'), payout = field(input, 'payout');
  const payoutMultiplier = field(input, 'payoutMultiplier'), costMultiplier = field(input, 'costMultiplier');
  const amount = field(input, 'amount');
  const economics = active
    ? { active: true as const, amount: stakeAmountMicros(amount) }
    : { active: false as const, amount: amount === undefined ? null : stakeAmountMicros(amount) };
  const facts: Omit<RoundFacts<T>, 'state'> = {
    betID, currency, mode,
    event: checkpoint === undefined || checkpoint === null ? null : stakeEventId(checkpoint),
    payout: payout === undefined ? null : stakeAmountMicros(payout),
    payoutMultiplier: payoutMultiplier === undefined ? null : stakeMultiplier(payoutMultiplier),
    costMultiplier: costMultiplier === undefined ? null : stakeMultiplier(costMultiplier),
  };
  const state = gameState(field(input, 'state'), codec);
  return Object.freeze({ ...facts, ...economics, state });
}

function boolean(input: unknown): boolean {
  if (typeof input !== 'boolean') invalid('jurisdiction boolean');
  return input;
}
export function parseJurisdiction(input: unknown): StakeJurisdiction {
  return Object.freeze({
    socialCasino: boolean(field(input, 'socialCasino')), disabledFullscreen: boolean(field(input, 'disabledFullscreen')),
    disabledTurbo: boolean(field(input, 'disabledTurbo')), disabledSuperTurbo: boolean(field(input, 'disabledSuperTurbo')),
    disabledAutoplay: boolean(field(input, 'disabledAutoplay')), disabledSlamstop: boolean(field(input, 'disabledSlamstop')),
    disabledSpacebar: boolean(field(input, 'disabledSpacebar')), disabledBuyFeature: boolean(field(input, 'disabledBuyFeature')),
    displayNetPosition: boolean(field(input, 'displayNetPosition')), displayRTP: boolean(field(input, 'displayRTP')),
    displaySessionTimer: boolean(field(input, 'displaySessionTimer')), minimumRoundDuration: stakeMinimumRoundDuration(field(input, 'minimumRoundDuration')),
  });
}
export function parseAuthenticateResponse<T>(input: unknown, codec: StakeGameStateCodec<T>, id: StakeSessionId, expected?: StakeCurrencyCode): StakeSession<T> {
  const balance = parseBalance(field(input, 'balance'), expected);
  const config = field(input, 'config');
  const minBet = stakeAmountMicros(field(config, 'minBet')), maxBet = stakeAmountMicros(field(config, 'maxBet'));
  const stepBet = stakeAmountMicros(field(config, 'stepBet')), defaultBetAmount = stakeAmountMicros(field(config, 'defaultBetLevel'));
  const levels = field(config, 'betLevels');
  if (!Array.isArray(levels) || !levels.length || minBet === 0 || maxBet < minBet || stepBet === 0) invalid('bet config');
  const suppliedLevels: readonly unknown[] = levels;
  const betLevels = Object.freeze(suppliedLevels.map(stakeAmountMicros));
  if (new Set(betLevels).size !== betLevels.length || betLevels.some(amount => amount < minBet || amount > maxBet) || !betLevels.includes(defaultBetAmount)) invalid('bet levels/default amount');
  const jurisdiction = parseJurisdiction(field(config, 'jurisdiction'));
  const suppliedRound = field(input, 'round');
  if (suppliedRound === undefined) invalid('authenticate.round');
  const round = suppliedRound === null ? null : parseRound(suppliedRound, balance.currency, codec);
  return Object.freeze({ id, balance, config: Object.freeze({ minBet, maxBet, stepBet, defaultBetAmount, betLevels }),
    jurisdiction, round });
}
export function parsePlayResponse<T>(input: unknown, codec: StakeGameStateCodec<T>, currency: StakeCurrencyCode): StakePlayResult<T> {
  const balance = parseBalance(field(input, 'balance'), currency);
  const round = parseRound(field(input, 'round'), currency, codec);
  if (round.amount === null) invalid('play round amount');
  return Object.freeze({ balance, round: round.active ? round : Object.freeze({ ...round, amount: round.amount }) });
}
export function parseEventResponse(input: unknown, expected: StakeEventId): StakeEventId {
  const event = stakeEventId(field(input, 'event'));
  if (event !== expected) invalid('event response mismatch');
  return event;
}
export function parseEndRoundResponse(input: unknown, currency: StakeCurrencyCode): StakeBalance {
  return parseBalance(field(input, 'balance'), currency);
}
export function parseReplayResponse<T>(input: unknown, codec: StakeGameStateCodec<T>): StakeReplayResult<T> {
  return Object.freeze({ payoutMultiplier: stakeMultiplier(field(input, 'payoutMultiplier')), costMultiplier: stakeMultiplier(field(input, 'costMultiplier')), state: gameState(field(input, 'state'), codec) });
}
export function activeRound<T>(session: StakeSession<T>): StakeActiveRound<T> | null {
  const round = session.round;
  return round?.active === true ? round : null;
}
export const ENDPOINT = Object.freeze({ AUTH: '/wallet/authenticate', PLAY: '/wallet/play', EVENT: '/bet/event', END: '/wallet/end-round', REPLAY: '/bet/replay' } as const);
