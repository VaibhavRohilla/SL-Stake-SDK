import { PROVIDER_FAILURE_KIND } from './vocabulary.js';
import type { StakePendingMutation } from './pendingPaidDispatch.js';
export const STAKE_ERROR_CATEGORY = Object.freeze({
  PROTOCOL: 'PROTOCOL', TRANSPORT: 'TRANSPORT', TIMEOUT: 'TIMEOUT', ABORTED: 'ABORTED',
  VALIDATION: 'VALIDATION', SESSION: 'SESSION', BUSINESS_REJECTION: 'BUSINESS_REJECTION',
  AMBIGUOUS_PAID_DISPATCH: 'AMBIGUOUS_PAID_DISPATCH', LIFECYCLE: 'LIFECYCLE',
} as const);
export type StakeSdkErrorCategory = typeof STAKE_ERROR_CATEGORY[keyof typeof STAKE_ERROR_CATEGORY];
export const STAKE_ERROR_CODE = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT', INVALID_RESPONSE: 'INVALID_RESPONSE', INVALID_JSON: 'INVALID_JSON',
  HTTP_FAILURE: 'HTTP_FAILURE', NETWORK_FAILURE: 'NETWORK_FAILURE', REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  REQUEST_ABORTED: 'REQUEST_ABORTED', DESTROYED: 'DESTROYED', BUSY: 'BUSY',
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED', CURRENCY_CHANGED: 'CURRENCY_CHANGED',
  ROUND_MISMATCH: 'ROUND_MISMATCH', ACTIVE_ROUND: 'ACTIVE_ROUND', PROVIDER_REJECTION: 'PROVIDER_REJECTION',
  PAID_DISPATCH_UNCERTAIN: 'PAID_DISPATCH_UNCERTAIN', RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  PENDING_STORAGE_FAILURE: 'PENDING_STORAGE_FAILURE', LEASE_UNAVAILABLE: 'LEASE_UNAVAILABLE', LEASE_CONFLICT: 'LEASE_CONFLICT', CODEC_FAILURE: 'CODEC_FAILURE',
} as const);
export type StakeSdkErrorCode = typeof STAKE_ERROR_CODE[keyof typeof STAKE_ERROR_CODE];
export const STAKE_DISPATCH_PHASE = Object.freeze({
  NOT_DISPATCHED: 'NOT_DISPATCHED', MAY_HAVE_DISPATCHED: 'MAY_HAVE_DISPATCHED', RESPONSE_RECEIVED: 'RESPONSE_RECEIVED',
} as const);
export type StakeDispatchPhase = typeof STAKE_DISPATCH_PHASE[keyof typeof STAKE_DISPATCH_PHASE];
export const STAKE_PROVIDER_ERROR_CODE = Object.freeze({
  ERR_VAL: 'ERR_VAL', ERR_IPB: 'ERR_IPB', ERR_IS: 'ERR_IS', ERR_ATE: 'ERR_ATE',
  ERR_GLE: 'ERR_GLE', ERR_LOC: 'ERR_LOC', ERR_GEN: 'ERR_GEN', ERR_MAINTENANCE: 'ERR_MAINTENANCE',
} as const);
export type StakeProviderErrorCode = typeof STAKE_PROVIDER_ERROR_CODE[keyof typeof STAKE_PROVIDER_ERROR_CODE];
export type StakeProviderRejectionCode = Exclude<StakeProviderErrorCode, 'ERR_GEN' | 'ERR_MAINTENANCE'>;
export type StakeProviderFailure =
  | { readonly kind: 'KNOWN'; readonly code: StakeProviderErrorCode }
  | { readonly kind: 'UNRECOGNIZED' }
  | { readonly kind: 'MALFORMED' };
interface FailureCodes {
  PROTOCOL: 'INVALID_RESPONSE' | 'INVALID_JSON' | 'HTTP_FAILURE';
  TRANSPORT: 'NETWORK_FAILURE';
  TIMEOUT: 'REQUEST_TIMEOUT';
  ABORTED: 'REQUEST_ABORTED';
  VALIDATION: 'INVALID_INPUT' | 'INVALID_RESPONSE' | 'CODEC_FAILURE';
  SESSION: 'NOT_AUTHENTICATED' | 'CURRENCY_CHANGED' | 'ROUND_MISMATCH' | 'ACTIVE_ROUND' |
    'PENDING_STORAGE_FAILURE' | 'LEASE_UNAVAILABLE' | 'LEASE_CONFLICT';
  LIFECYCLE: 'DESTROYED' | 'BUSY';
}
type RequestFailure =
  | { readonly category: 'PROTOCOL'; readonly code: FailureCodes['PROTOCOL']; readonly dispatch: StakeDispatchPhase; readonly provider: StakeProviderFailure | null }
  | { [C in Exclude<keyof FailureCodes, 'PROTOCOL'>]: {
      readonly category: C; readonly code: FailureCodes[C]; readonly dispatch: StakeDispatchPhase;
    } }[Exclude<keyof FailureCodes, 'PROTOCOL'>];
export type StakeAmbiguousDispatchReason = RequestFailure;
export type StakeSdkFailure = RequestFailure
  | { readonly category: 'BUSINESS_REJECTION'; readonly code: 'PROVIDER_REJECTION'; readonly dispatch: StakeDispatchPhase;
      readonly providerCode: StakeProviderRejectionCode }
  | { readonly category: 'AMBIGUOUS_PAID_DISPATCH'; readonly code: 'PAID_DISPATCH_UNCERTAIN';
      readonly dispatch: Exclude<StakeDispatchPhase, 'NOT_DISPATCHED'>; readonly reason: StakeAmbiguousDispatchReason;
      readonly pending: StakePendingMutation }
  | { readonly category: 'AMBIGUOUS_PAID_DISPATCH'; readonly code: 'RECONCILIATION_REQUIRED';
      readonly dispatch: typeof STAKE_DISPATCH_PHASE.NOT_DISPATCHED; readonly pending: StakePendingMutation };
/** Safe messages only. Branch on failure.category/code; ambiguity always carries reconciliation facts. */
export class StakeSdkError extends Error {
  override readonly name = 'StakeSdkError';
  readonly failure: StakeSdkFailure;
  constructor(failure: StakeSdkFailure, message: string) {
    super(message);
    if (failure.category === STAKE_ERROR_CATEGORY.AMBIGUOUS_PAID_DISPATCH) {
      const pending = Object.freeze({ ...failure.pending });
      if (failure.code === STAKE_ERROR_CODE.PAID_DISPATCH_UNCERTAIN) {
        const reason = failure.reason.category === STAKE_ERROR_CATEGORY.PROTOCOL
          ? Object.freeze({ ...failure.reason, provider: failure.reason.provider === null ? null : Object.freeze({ ...failure.reason.provider }) })
          : Object.freeze({ ...failure.reason });
        this.failure = Object.freeze({ ...failure, pending, reason });
      } else this.failure = Object.freeze({ ...failure, pending });
    } else if (failure.category === STAKE_ERROR_CATEGORY.PROTOCOL) {
      this.failure = Object.freeze({ ...failure, provider: failure.provider === null ? null : Object.freeze({ ...failure.provider }) });
    } else this.failure = Object.freeze({ ...failure });
  }
  get category(): StakeSdkErrorCategory { return this.failure.category; }
  get code(): StakeSdkErrorCode { return this.failure.code; }
  get dispatch(): StakeDispatchPhase { return this.failure.dispatch; }
}
export function invalid(field: string): never {
  throw new StakeSdkError({ category: STAKE_ERROR_CATEGORY.VALIDATION, code: STAKE_ERROR_CODE.INVALID_INPUT,
    dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, `Invalid ${field}`);
}
/** Unknown codes are discarded, never published or used as evidence of nonacceptance. */
export function parseProviderError(input: unknown): StakeProviderFailure | null {
  if (input === null || typeof input !== 'object') return null;
  const descriptor = Object.getOwnPropertyDescriptor(input, 'error');
  if (!descriptor) return null;
  const code: unknown = descriptor.value;
  if (!Object.hasOwn(descriptor, 'value') || typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) return Object.freeze({ kind: PROVIDER_FAILURE_KIND.MALFORMED });
  for (const known of Object.values(STAKE_PROVIDER_ERROR_CODE)) if (code === known) return Object.freeze({ kind: PROVIDER_FAILURE_KIND.KNOWN, code: known });
  return Object.freeze({ kind: PROVIDER_FAILURE_KIND.UNRECOGNIZED });
}
export function isRejectionCode(code: StakeProviderErrorCode): code is StakeProviderRejectionCode {
  return code !== STAKE_PROVIDER_ERROR_CODE.ERR_GEN && code !== STAKE_PROVIDER_ERROR_CODE.ERR_MAINTENANCE;
}
