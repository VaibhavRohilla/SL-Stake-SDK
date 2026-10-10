import { StakeSdkError, STAKE_ERROR_CATEGORY as CATEGORY, STAKE_ERROR_CODE as CODE } from './errors.js';
import { fields, parseRoundId } from './protocol.js';
import type { StakeRoundId } from './protocol.js';
import { stakeAmountMicros, stakeCurrencyCode } from './money.js';
import type { StakeAmountMicros, StakeCurrencyCode } from './money.js';
import { text } from './launch.js';
/** Supply sessionStorage/localStorage or an equivalent synchronous store to retain uncertainty across client recreation. */
export type StakePendingDispatchStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type Pending =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'PLAY'; readonly amount: StakeAmountMicros; readonly mode: string; readonly currency: StakeCurrencyCode; readonly previous: StakeRoundId | undefined }
  | { readonly kind: 'EVENT'; readonly betID: StakeRoundId; readonly event: string }
  | { readonly kind: 'END_ROUND'; readonly betID: StakeRoundId };
/** Owns the unresolved mutation, optionally journaled under a cryptographic session-scoped key. */
export class PendingPaidDispatch {
  #value: Pending = { kind: 'NONE' };
  #state: 'UNLOADED' | 'LOADED' | 'DESTROYED' = 'UNLOADED';
  #key: string | undefined;
  #storage: StakePendingDispatchStorage | undefined;
  constructor(readonly explicitStorage: StakePendingDispatchStorage | undefined, readonly browserLease: boolean) {}
  get value(): Pending { return this.#value; }
  #alive(): void { if (this.#state === 'DESTROYED') throw new StakeSdkError(CATEGORY.LIFECYCLE, CODE.DESTROYED, 'Client destroyed'); }
  async load(base: string, sessionID: string): Promise<void> {
    this.#alive();
    if (this.#state === 'LOADED') return;
    if (!this.explicitStorage && !this.browserLease) { this.#state = 'LOADED'; return; }
    try {
      this.#storage = this.explicitStorage ?? globalThis.localStorage;
      if (!this.#storage || !globalThis.crypto?.subtle) throw new Error('storage/crypto unavailable');
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([base, sessionID])));
      this.#alive();
      this.#key = `fnx:stake:pending:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
      const stored = this.#storage.getItem(this.#key);
      if (stored !== null) {
        const input: unknown = JSON.parse(stored);
        const value = fields(input);
        if (value.kind === 'PLAY') {
          this.#value = Object.freeze({ kind: 'PLAY', amount: stakeAmountMicros(value.amount), mode: text(value.mode, 'pending mode'),
            currency: stakeCurrencyCode(value.currency), previous: value.previous === undefined ? undefined : parseRoundId(value.previous) });
        } else if (value.kind === 'EVENT') this.#value = Object.freeze({ kind: 'EVENT', betID: parseRoundId(value.betID), event: text(value.event, 'pending event') });
        else if (value.kind === 'END_ROUND') this.#value = Object.freeze({ kind: 'END_ROUND', betID: parseRoundId(value.betID) });
        else throw new Error('invalid pending marker');
      }
      this.#state = 'LOADED';
    } catch (error) {
      if (error instanceof StakeSdkError && error.category === CATEGORY.LIFECYCLE) throw error;
      throw new StakeSdkError(CATEGORY.SESSION, CODE.PENDING_STORAGE_FAILURE, 'Pending mutation storage unavailable or corrupt');
    }
  }
  prepare(value: Pending): void {
    this.#alive();
    if (this.#state !== 'LOADED' || this.#value.kind !== 'NONE') throw new StakeSdkError(CATEGORY.AMBIGUOUS_PAID_DISPATCH,
      CODE.RECONCILIATION_REQUIRED, 'Pending mutation must be reconciled');
    try { if (this.#storage && this.#key) this.#storage.setItem(this.#key, JSON.stringify(value)); }
    catch { throw new StakeSdkError(CATEGORY.SESSION, CODE.PENDING_STORAGE_FAILURE, 'Cannot record pending mutation'); }
    this.#value = Object.freeze(value);
  }
  clear(): void {
    this.#alive();
    try { if (this.#storage && this.#key) this.#storage.removeItem(this.#key); }
    catch { throw new StakeSdkError(CATEGORY.SESSION, CODE.PENDING_STORAGE_FAILURE, 'Cannot clear pending mutation'); }
    this.#value = { kind: 'NONE' };
  }
  discardUndispatched(): void {
    // A caller holding typed NOT_DISPATCHED evidence may remove its prepared journal during teardown.
    try { if (this.#storage && this.#key) this.#storage.removeItem(this.#key); }
    catch { throw new StakeSdkError(CATEGORY.SESSION, CODE.PENDING_STORAGE_FAILURE, 'Cannot discard undispatched mutation'); }
    this.#value = { kind: 'NONE' };
  }
  /** Destruction must never erase an uncertain dispatch marker. */
  destroy(): void { this.#state = 'DESTROYED'; }
}
