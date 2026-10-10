import { STAKE_DISPATCH_PHASE } from './errors.js';
import { StakeSdkError, STAKE_ERROR_CATEGORY as CATEGORY, STAKE_ERROR_CODE as CODE } from './errors.js';
import { stakeBetId, stakeBetMode, stakeEventId } from './domain.js';
import type { StakeBetId, StakeBetMode, StakeEventId, StakeSessionId } from './domain.js';
import { MUTATION, JOURNAL } from './vocabulary.js';
import { stakeAmountMicros, stakeCurrencyCode } from './money.js';
import type { StakeAmountMicros, StakeCurrencyCode } from './money.js';

/** Supply sessionStorage/localStorage or an equivalent synchronous store to retain uncertainty across client recreation. */
export interface StakePendingDispatchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export type StakePendingMutation =
  | { readonly kind: 'PLAY'; readonly amount: StakeAmountMicros; readonly mode: StakeBetMode; readonly currency: StakeCurrencyCode; readonly previous: StakeBetId | null }
  | { readonly kind: 'EVENT'; readonly betID: StakeBetId; readonly event: StakeEventId }
  | { readonly kind: 'END_ROUND'; readonly betID: StakeBetId };
type Pending = { readonly kind: 'NONE' } | StakePendingMutation;
const JOURNAL_VERSION = 1;
type StakePendingDispatchRecordV1 = StakePendingMutation & { readonly version: typeof JOURNAL_VERSION };
function parsePendingRecord(input: unknown): StakePendingMutation {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid pending journal object');
  const value = input;
  if (!('version' in value) || value.version !== JOURNAL_VERSION) throw new Error('Unsupported pending journal version');
  if (!('kind' in value)) throw new Error('Missing pending mutation kind');
  switch (value.kind) {
    case MUTATION.PLAY:
      if (!('amount' in value) || !('mode' in value) || !('currency' in value) || !('previous' in value)) throw new Error('Missing play journal facts');
      return Object.freeze({ kind: MUTATION.PLAY, amount: stakeAmountMicros(value.amount), mode: stakeBetMode(value.mode),
        currency: stakeCurrencyCode(value.currency), previous: value.previous === null ? null : stakeBetId(value.previous) });
    case MUTATION.EVENT:
      if (!('betID' in value) || !('event' in value)) throw new Error('Missing event journal facts');
      return Object.freeze({ kind: MUTATION.EVENT, betID: stakeBetId(value.betID), event: stakeEventId(value.event) });
    case MUTATION.END_ROUND:
      if (!('betID' in value)) throw new Error('Missing end-round journal facts');
      return Object.freeze({ kind: MUTATION.END_ROUND, betID: stakeBetId(value.betID) });
    default: throw new Error('Invalid pending marker');
  }
}
/** Owns the unresolved mutation, optionally journaled under a cryptographic session-scoped key. */
export class PendingPaidDispatch {
  #value: Pending = { kind: MUTATION.NONE };
  #state: typeof JOURNAL[keyof typeof JOURNAL] = JOURNAL.UNLOADED;
  #key: string | undefined;
  #storage: StakePendingDispatchStorage | undefined;
  constructor(readonly explicitStorage: StakePendingDispatchStorage | undefined, readonly browserLease: boolean) {}
  get value(): Pending { return this.#value; }
  #alive(): void { if (this.#state === JOURNAL.DESTROYED) throw new StakeSdkError({ category: CATEGORY.LIFECYCLE, code: CODE.DESTROYED, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Client destroyed'); }
  async load(base: string, sessionID: StakeSessionId): Promise<void> {
    this.#alive();
    if (this.#state === JOURNAL.LOADED) return;
    if (!this.explicitStorage && !this.browserLease) { this.#state = JOURNAL.LOADED; return; }
    try {
      this.#storage = this.explicitStorage ?? globalThis.localStorage;
      if (!this.#storage || !globalThis.crypto?.subtle) throw new Error('storage/crypto unavailable');
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([base, sessionID])));
      this.#alive();
      this.#key = `fnx:stake:pending:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
      const stored = this.#storage.getItem(this.#key);
      let pending: Pending = { kind: MUTATION.NONE };
      if (stored !== null) {
        const input: unknown = JSON.parse(stored);
        pending = parsePendingRecord(input);
      }
      this.#alive();
      this.#value = pending;
      this.#state = JOURNAL.LOADED;
    } catch {
      this.#alive();
      throw new StakeSdkError({ category: CATEGORY.SESSION, code: CODE.PENDING_STORAGE_FAILURE, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Pending mutation storage unavailable or corrupt');
    }
  }
  prepare(value: StakePendingMutation): void {
    this.#alive();
    if (this.#state !== JOURNAL.LOADED || this.#value.kind !== MUTATION.NONE) throw new StakeSdkError({ category: CATEGORY.SESSION, code: CODE.PENDING_STORAGE_FAILURE, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Pending journal not ready');
    try { if (this.#storage && this.#key) { const record: StakePendingDispatchRecordV1 = { version: JOURNAL_VERSION, ...value }; this.#storage.setItem(this.#key, JSON.stringify(record)); } }
    catch { throw new StakeSdkError({ category: CATEGORY.SESSION, code: CODE.PENDING_STORAGE_FAILURE, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Cannot record pending mutation'); }
    this.#value = Object.freeze(value);
  }
  clear(): void {
    this.#alive();
    try { if (this.#storage && this.#key) this.#storage.removeItem(this.#key); }
    catch { throw new StakeSdkError({ category: CATEGORY.SESSION, code: CODE.PENDING_STORAGE_FAILURE, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Cannot clear pending mutation'); }
    this.#value = { kind: MUTATION.NONE };
  }
  discardUndispatched(): void {
    // A caller holding typed NOT_DISPATCHED evidence may remove its prepared journal during teardown.
    try { if (this.#storage && this.#key) this.#storage.removeItem(this.#key); }
    catch { throw new StakeSdkError({ category: CATEGORY.SESSION, code: CODE.PENDING_STORAGE_FAILURE, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Cannot discard undispatched mutation'); }
    this.#value = { kind: MUTATION.NONE };
  }
  /** Destruction must never erase an uncertain dispatch marker. */
  destroy(): void { this.#state = JOURNAL.DESTROYED; }
}
