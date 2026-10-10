import { invalid } from './errors.js';
declare const micros: unique symbol;
declare const currency: unique symbol;
/** Exactly 1,000,000 Stake micros per major currency unit. */
export type StakeAmountMicros = number & { readonly [micros]: true };
export type StakeCurrencyCode = string & { readonly [currency]: true };
export function stakeAmountMicros(input: unknown): StakeAmountMicros {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) invalid('Stake micros');
  return input as StakeAmountMicros;
}
export function stakeCurrencyCode(input: unknown): StakeCurrencyCode {
  if (typeof input !== 'string' || !/^[A-Z][A-Z0-9]{1,11}$/.test(input)) invalid('Stake currency');
  return input as StakeCurrencyCode;
}
