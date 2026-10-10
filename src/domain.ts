import { invalid } from './errors.js';
declare const brand: unique symbol;
type Brand<T, Name extends string> = T & { readonly [brand]: Name };
export type StakeSessionId = Brand<string, 'StakeSessionId'>;
export type StakeNumericBetId = Brand<number, 'StakeNumericBetId'>;
export type StakeStringBetId = Brand<string, 'StakeStringBetId'>;
export type StakeBetId = StakeNumericBetId | StakeStringBetId;
export type StakeBetMode = Brand<string, 'StakeBetMode'>;
export type StakeEventId = Brand<string, 'StakeEventId'>;
export type StakeGameId = Brand<string, 'StakeGameId'>;
export type StakeGameVersion = Brand<string, 'StakeGameVersion'>;
export type StakeReplayEventId = Brand<string, 'StakeReplayEventId'>;
export type StakeMultiplier = Brand<number, 'StakeMultiplier'>;
/** Opaque provider duration. Upstream does not establish a unit; never interpret as milliseconds. */
export type StakeMinimumRoundDuration = Brand<number, 'StakeMinimumRoundDuration'>;
export const STAKE_LANGUAGE = Object.freeze({
  AR: 'ar', DE: 'de', EN: 'en', ES: 'es', FI: 'fi', FR: 'fr', HI: 'hi', ID: 'id',
  JA: 'ja', KO: 'ko', PL: 'pl', PT: 'pt', RU: 'ru', TR: 'tr', VI: 'vi', ZH: 'zh',
} as const);
export type StakeLanguage = typeof STAKE_LANGUAGE[keyof typeof STAKE_LANGUAGE];
export const STAKE_DEVICE = Object.freeze({ DESKTOP: 'desktop', MOBILE: 'mobile' } as const);
export type StakeDevice = typeof STAKE_DEVICE[keyof typeof STAKE_DEVICE];
/** Reject surrounding whitespace and control characters; never trim or synthesize provider identity. */
export function text(input: unknown, field: string): string {
  if (typeof input !== 'string' || input.length === 0 || input !== input.trim() || /[\u0000-\u001f\u007f]/.test(input)) invalid(field);
  return input;
}
export function stakeSessionId(input: unknown): StakeSessionId { return text(input, 'session ID') as StakeSessionId; }
export function stakeBetId(input: unknown): StakeBetId {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input) || input < 0) invalid('bet ID');
    return input as StakeNumericBetId;
  }
  return text(input, 'bet ID') as StakeStringBetId;
}
export function stakeBetMode(input: unknown): StakeBetMode { return text(input, 'bet mode') as StakeBetMode; }
export function stakeEventId(input: unknown): StakeEventId { return text(input, 'event ID') as StakeEventId; }
export function stakeGameId(input: unknown): StakeGameId { return text(input, 'game ID') as StakeGameId; }
export function stakeGameVersion(input: unknown): StakeGameVersion { return text(input, 'game version') as StakeGameVersion; }
export function stakeReplayEventId(input: unknown): StakeReplayEventId { return text(input, 'replay event ID') as StakeReplayEventId; }
export function stakeLanguage(input: unknown): StakeLanguage {
  for (const value of Object.values(STAKE_LANGUAGE)) if (input === value) return value;
  return invalid('language');
}
export function stakeDevice(input: unknown): StakeDevice {
  for (const value of Object.values(STAKE_DEVICE)) if (input === value) return value;
  return invalid('device');
}
export function stakeMultiplier(input: unknown): StakeMultiplier {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0) invalid('multiplier');
  return input as StakeMultiplier;
}
export function stakeMinimumRoundDuration(input: unknown): StakeMinimumRoundDuration {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) invalid('minimum round duration');
  return input as StakeMinimumRoundDuration;
}
