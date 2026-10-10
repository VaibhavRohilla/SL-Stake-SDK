import { STAKE_DISPATCH_PHASE } from './errors.js';
import { StakeSdkError, STAKE_ERROR_CATEGORY as CATEGORY, STAKE_ERROR_CODE as CODE } from './errors.js';
import type { StakeSessionId } from './domain.js';
import { LEASE } from './vocabulary.js';
/** Opt-in browser policy. Web Locks provide atomic same-origin same-session exclusion. */
export const STAKE_SESSION_LEASE_POLICY = Object.freeze({ NONE: 'NONE', WEB_LOCKS: 'WEB_LOCKS' } as const);
export type StakeSessionLeasePolicy =
  | { readonly kind: typeof STAKE_SESSION_LEASE_POLICY.NONE }
  | { readonly kind: typeof STAKE_SESSION_LEASE_POLICY.WEB_LOCKS };
export class SessionLease {
  #state: typeof LEASE[keyof typeof LEASE] = LEASE.UNACQUIRED;
  #release: (() => void) | undefined;
  #abort = new AbortController();
  #isDestroyed(): boolean { return this.#state === LEASE.DESTROYED; }
  async acquire(base: string, sessionID: StakeSessionId, signal?: AbortSignal): Promise<void> {
    if (this.#isDestroyed()) throw new StakeSdkError({ category: CATEGORY.LIFECYCLE, code: CODE.DESTROYED, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Client destroyed');
    if (signal?.aborted) throw new StakeSdkError({ category: CATEGORY.ABORTED, code: CODE.REQUEST_ABORTED, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Lease acquisition aborted');
    if (this.#state === LEASE.HELD) return;
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.locks || !globalThis.crypto?.subtle) {
      throw new StakeSdkError({ category: CATEGORY.SESSION, code: CODE.LEASE_UNAVAILABLE, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Browser Web Locks unavailable');
    }
    const controller = this.#abort;
    const aborted = (): StakeSdkError => this.#isDestroyed()
      ? new StakeSdkError({ category: CATEGORY.LIFECYCLE, code: CODE.DESTROYED, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Client destroyed')
      : new StakeSdkError({ category: CATEGORY.ABORTED, code: CODE.REQUEST_ABORTED, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Lease acquisition aborted');
    const forward = (): void => controller.abort();
    signal?.addEventListener('abort', forward, { once: true });
    let rejectAbort: (() => void) | undefined;
    const interruption = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(aborted());
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    try {
      const hash = await Promise.race([crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([base, sessionID]))), interruption]);
      if (controller.signal.aborted) throw aborted();
      const key = `fnx:stake:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
      const held = new Promise<void>(resolve => { this.#release = resolve; });
      await Promise.race([new Promise<void>((resolve, reject) => {
        // The platform forbids combining ifAvailable with signal; manually fence the nonqueued callback.
        void navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
          if (controller.signal.aborted || this.#isDestroyed()) { reject(aborted()); return; }
          if (!lock) { reject(new StakeSdkError({ category: CATEGORY.SESSION, code: CODE.LEASE_CONFLICT, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Session already leased')); return; }
          this.#state = LEASE.HELD;
          resolve();
          await held;
        }).catch(() => reject(new StakeSdkError({ category: CATEGORY.SESSION, code: CODE.LEASE_UNAVAILABLE, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'Lease request failed')));
      }), interruption]);
    } finally {
      signal?.removeEventListener('abort', forward);
      if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
      if (!this.#isDestroyed() && controller.signal.aborted) this.#abort = new AbortController();
    }
  }
  destroy(): void {
    this.#state = LEASE.DESTROYED;
    this.#abort.abort();
    this.#release?.();
    this.#release = undefined;
  }
}
