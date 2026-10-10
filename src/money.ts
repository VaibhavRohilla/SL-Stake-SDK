import { invalid } from './errors.js';
declare const micros: unique symbol;
/** Exactly 1,000,000 Stake micros per major currency unit. */
export type StakeAmountMicros = number & { readonly [micros]: true };
export const STAKE_CURRENCY_CODE = Object.freeze({
  USD: 'USD',
  CAD: 'CAD',
  JPY: 'JPY',
  EUR: 'EUR',
  RUB: 'RUB',
  CNY: 'CNY',
  PHP: 'PHP',
  INR: 'INR',
  IDR: 'IDR',
  KRW: 'KRW',
  BRL: 'BRL',
  MXN: 'MXN',
  DKK: 'DKK',
  PLN: 'PLN',
  VND: 'VND',
  TRY: 'TRY',
  CLP: 'CLP',
  ARS: 'ARS',
  PEN: 'PEN',
  NGN: 'NGN',
  SAR: 'SAR',
  ILS: 'ILS',
  AED: 'AED',
  TWD: 'TWD',
  NOK: 'NOK',
  KWD: 'KWD',
  JOD: 'JOD',
  CRC: 'CRC',
  TND: 'TND',
  SGD: 'SGD',
  MYR: 'MYR',
  OMR: 'OMR',
  QAR: 'QAR',
  BHD: 'BHD',
  XGC: 'XGC',
  XSC: 'XSC',
} as const);
export type StakeCurrencyCode = typeof STAKE_CURRENCY_CODE[keyof typeof STAKE_CURRENCY_CODE];
export function stakeAmountMicros(input: unknown): StakeAmountMicros {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) invalid('Stake micros');
  return input as StakeAmountMicros;
}
export function stakeCurrencyCode(input: unknown): StakeCurrencyCode {
  for (const value of Object.values(STAKE_CURRENCY_CODE)) if (input === value) return value;
  return invalid('Stake currency');
}
