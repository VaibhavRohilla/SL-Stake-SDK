export const STAKE_ERROR_CATEGORY = {
  PROTOCOL: 'PROTOCOL', TRANSPORT: 'TRANSPORT', TIMEOUT: 'TIMEOUT', ABORTED: 'ABORTED',
  VALIDATION: 'VALIDATION', SESSION: 'SESSION', BUSINESS_REJECTION: 'BUSINESS_REJECTION',
  AMBIGUOUS_PAID_DISPATCH: 'AMBIGUOUS_PAID_DISPATCH', LIFECYCLE: 'LIFECYCLE',
} as const;
export type StakeSdkErrorCategory = typeof STAKE_ERROR_CATEGORY[keyof typeof STAKE_ERROR_CATEGORY];
export const STAKE_ERROR_CODE = {
  INVALID_INPUT: 'INVALID_INPUT', INVALID_RESPONSE: 'INVALID_RESPONSE', INVALID_JSON: 'INVALID_JSON',
  HTTP_FAILURE: 'HTTP_FAILURE', NETWORK_FAILURE: 'NETWORK_FAILURE', REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  REQUEST_ABORTED: 'REQUEST_ABORTED', DESTROYED: 'DESTROYED', BUSY: 'BUSY',
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED', CURRENCY_CHANGED: 'CURRENCY_CHANGED',
  ROUND_MISMATCH: 'ROUND_MISMATCH', ACTIVE_ROUND: 'ACTIVE_ROUND', PROVIDER_REJECTION: 'PROVIDER_REJECTION',
  PAID_DISPATCH_UNCERTAIN: 'PAID_DISPATCH_UNCERTAIN', RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  PENDING_STORAGE_FAILURE: 'PENDING_STORAGE_FAILURE', LEASE_UNAVAILABLE: 'LEASE_UNAVAILABLE', LEASE_CONFLICT: 'LEASE_CONFLICT', CODEC_FAILURE: 'CODEC_FAILURE',
} as const;
export type StakeSdkErrorCode = typeof STAKE_ERROR_CODE[keyof typeof STAKE_ERROR_CODE];
export type StakeDispatchState = 'NOT_DISPATCHED' | 'MAY_HAVE_DISPATCHED' | 'RESPONSE_RECEIVED';
/** Messages deliberately exclude provider payloads, credentials, and arbitrary transport errors. */
export class StakeSdkError extends Error {
  override readonly name = 'StakeSdkError';
  constructor(
    readonly category: StakeSdkErrorCategory,
    readonly code: StakeSdkErrorCode,
    message: string,
    readonly dispatch: StakeDispatchState = 'NOT_DISPATCHED',
    readonly providerCode?: string,
    readonly reason?: StakeSdkErrorCategory,
  ) { super(message); }
}
export function invalid(field: string): never {
  throw new StakeSdkError(STAKE_ERROR_CATEGORY.VALIDATION, STAKE_ERROR_CODE.INVALID_INPUT, `Invalid ${field}`);
}
