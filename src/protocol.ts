import { invalid, StakeSdkError, STAKE_ERROR_CATEGORY, STAKE_ERROR_CODE } from './errors.js';
import { text } from './launch.js';
import { stakeAmountMicros, stakeCurrencyCode } from './money.js';
import type { StakeAmountMicros, StakeCurrencyCode } from './money.js';
export interface StakeGameStateCodec<TState> { parse(input: unknown): TState }
export type StakeRoundId = string | number;
export interface StakeBalance { readonly amount: StakeAmountMicros; readonly currency: StakeCurrencyCode }
export interface StakeRound<TState> {
  readonly betID: StakeRoundId;
  readonly amount: StakeAmountMicros;
  readonly currency: StakeCurrencyCode;
  readonly active: boolean;
  readonly mode: string;
  readonly state: TState;
  readonly event?: string | null;
  readonly payout?: StakeAmountMicros;
  readonly payoutMultiplier?: number;
  readonly costMultiplier?: number;
}
export interface StakeActiveRound<TState> extends StakeRound<TState> { readonly active: true }
export interface StakeJurisdictionFlags {
  readonly socialCasino?: boolean;
  readonly disabledFullscreen?: boolean;
  readonly disabledTurbo?: boolean;
  readonly disabledSuperTurbo?: boolean;
  readonly disabledAutoplay?: boolean;
  readonly disabledSlamstop?: boolean;
  readonly disabledSpacebar?: boolean;
  readonly disabledBuyFeature?: boolean;
  readonly displayNetPosition?: boolean;
  readonly displayRTP?: boolean;
  readonly displaySessionTimer?: boolean;
  readonly minimumRoundDuration?: number;
}
export interface StakeBetConfig {
  readonly minBet: StakeAmountMicros; readonly maxBet: StakeAmountMicros;
  readonly stepBet: StakeAmountMicros; readonly defaultBetAmount: StakeAmountMicros;
  readonly betLevels: readonly StakeAmountMicros[];
  readonly gameID?: string;
  readonly jurisdiction?: StakeJurisdictionFlags;
}
export interface StakeSession<TState> {
  readonly balance: StakeBalance;
  readonly config: StakeBetConfig;
  readonly round: StakeRound<TState> | null;
  readonly jurisdictionFlags?: StakeJurisdictionFlags;
}
export interface StakePlayResult<TState> { readonly balance: StakeBalance; readonly round: StakeRound<TState> }
export interface StakeReplayResult<TState> {
  readonly state: TState; readonly payoutMultiplier: number; readonly costMultiplier: number;
}
// Object bags exist only at the untrusted parsing boundary, never in public domain objects.
export function fields(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalid('response object');
  return input as Record<string, unknown>;
}
export function parseBalance(input: unknown, expected?: StakeCurrencyCode): StakeBalance {
  const value = fields(input);
  const currency = stakeCurrencyCode(value.currency);
  if (expected !== undefined && currency !== expected) throw new StakeSdkError(
    STAKE_ERROR_CATEGORY.SESSION, STAKE_ERROR_CODE.CURRENCY_CHANGED, 'Authenticated currency changed');
  return Object.freeze({ amount: stakeAmountMicros(value.amount), currency });
}
export function parseRoundId(input: unknown): StakeRoundId {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input) || input < 0) invalid('betID');
    return input;
  }
  return text(input, 'betID');
}
function multiplier(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0) invalid('multiplier');
  return input;
}
function gameState<T>(input: unknown, codec: StakeGameStateCodec<T>): T {
  if (input === undefined) invalid('game state');
  try {
    // Copy before freezing: a codec cannot leave caller-owned mutable state attached to published facts.
    return freezeState(structuredClone(codec.parse(input)));
  } catch {
    throw new StakeSdkError(STAKE_ERROR_CATEGORY.VALIDATION, STAKE_ERROR_CODE.CODEC_FAILURE, 'Game state codec failed');
  }
}
function freezeState<T>(state: T, seen = new WeakSet<object>()): T {
  if (state !== null && typeof state === 'object') {
    if (seen.has(state)) return state;
    seen.add(state);
    if (!Array.isArray(state) && Object.getPrototypeOf(state) !== Object.prototype && Object.getPrototypeOf(state) !== null) invalid('codec state: plain data required');
    for (const child of Object.values(state)) freezeState(child, seen);
    Object.freeze(state);
  }
  if (typeof state === 'function' || typeof state === 'symbol') invalid('codec state: plain data required');
  return state;
}
export function parseRound<T>(input: unknown, currency: StakeCurrencyCode, codec: StakeGameStateCodec<T>): StakeRound<T> {
  const value = fields(input);
  if (typeof value.active !== 'boolean') invalid('round.active');
  if (value.currency !== undefined && stakeCurrencyCode(value.currency) !== currency) invalid('round.currency');
  return Object.freeze({ betID: parseRoundId(value.betID), amount: stakeAmountMicros(value.amount), currency,
    active: value.active, mode: text(value.mode, 'round.mode'), state: gameState(value.state, codec),
    ...(value.event === undefined ? {} : { event: value.event === null ? null : text(value.event, 'round.event') }),
    ...(value.payout === undefined ? {} : { payout: stakeAmountMicros(value.payout) }),
    ...(value.payoutMultiplier === undefined ? {} : { payoutMultiplier: multiplier(value.payoutMultiplier) }),
    ...(value.costMultiplier === undefined ? {} : { costMultiplier: multiplier(value.costMultiplier) }),
  });
}
const JURISDICTION_BOOLEAN_KEYS = ['socialCasino', 'disabledFullscreen', 'disabledTurbo', 'disabledSuperTurbo',
  'disabledAutoplay', 'disabledSlamstop', 'disabledSpacebar', 'disabledBuyFeature',
  'displayNetPosition', 'displayRTP', 'displaySessionTimer'] as const;
function parseJurisdiction(input: unknown): StakeJurisdictionFlags {
  const value = fields(input);
  const flags: { -readonly [K in keyof StakeJurisdictionFlags]?: StakeJurisdictionFlags[K] } = {};
  for (const key of JURISDICTION_BOOLEAN_KEYS) {
    const flag = value[key];
    if (flag !== undefined) { if (typeof flag !== 'boolean') invalid('jurisdiction flag'); flags[key] = flag; }
  }
  if (value.minimumRoundDuration !== undefined) flags.minimumRoundDuration = multiplier(value.minimumRoundDuration);
  return Object.freeze(flags);
}
export function parseSession<T>(input: unknown, codec: StakeGameStateCodec<T>, expected?: StakeCurrencyCode): StakeSession<T> {
  const value = fields(input);
  const balance = parseBalance(value.balance, expected);
  const config = fields(value.config);
  const minBet = stakeAmountMicros(config.minBet), maxBet = stakeAmountMicros(config.maxBet);
  const stepBet = stakeAmountMicros(config.stepBet), defaultBetAmount = stakeAmountMicros(config.defaultBetLevel);
  if (!Array.isArray(config.betLevels) || !config.betLevels.length || minBet === 0 || maxBet < minBet || stepBet === 0) invalid('bet config');
  const betLevels = Object.freeze(config.betLevels.map(stakeAmountMicros));
  if (new Set(betLevels).size !== betLevels.length || betLevels.some(amount => amount < minBet || amount > maxBet) || !betLevels.includes(defaultBetAmount)) invalid('bet levels/default amount');
  if (!Object.hasOwn(value, 'round')) invalid('authenticate.round');
  const round = value.round === null ? null : parseRound(value.round, balance.currency, codec);
  const jurisdiction = config.jurisdiction === undefined ? undefined : parseJurisdiction(config.jurisdiction);
  const jurisdictionFlags = value.jurisdictionFlags === undefined ? undefined : parseJurisdiction(value.jurisdictionFlags);
  if (jurisdiction && jurisdictionFlags) {
    for (const key of [...JURISDICTION_BOOLEAN_KEYS, 'minimumRoundDuration'] as const) {
      if (jurisdiction[key] !== undefined && jurisdictionFlags[key] !== undefined && jurisdiction[key] !== jurisdictionFlags[key]) invalid('conflicting jurisdiction facts');
    }
  }
  return Object.freeze({ balance, config: Object.freeze({ minBet, maxBet, stepBet, defaultBetAmount, betLevels,
    ...(config.gameID === undefined ? {} : { gameID: text(config.gameID, 'config.gameID') }),
    ...(jurisdiction === undefined ? {} : { jurisdiction }),
  }), round, ...(jurisdictionFlags === undefined ? {} : { jurisdictionFlags }) });
}
export function parsePlay<T>(input: unknown, codec: StakeGameStateCodec<T>, currency: StakeCurrencyCode): StakePlayResult<T> {
  const value = fields(input), balance = parseBalance(value.balance, currency);
  return Object.freeze({ balance, round: parseRound(value.round, currency, codec) });
}
export function parseReplay<T>(input: unknown, codec: StakeGameStateCodec<T>): StakeReplayResult<T> {
  const value = fields(input);
  return Object.freeze({ payoutMultiplier: multiplier(value.payoutMultiplier), costMultiplier: multiplier(value.costMultiplier), state: gameState(value.state, codec) });
}
export function activeRound<T>(session: StakeSession<T>): StakeActiveRound<T> | null {
  const round = session.round;
  return round?.active === true ? Object.freeze({ ...round, active: true }) : null;
}
export const ENDPOINT = { AUTH: '/wallet/authenticate', PLAY: '/wallet/play', EVENT: '/bet/event', END: '/wallet/end-round', REPLAY: '/bet/replay' } as const;
