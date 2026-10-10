import { StakeSdkError, STAKE_ERROR_CATEGORY as CATEGORY, STAKE_ERROR_CODE as CODE } from './errors.js';
/** Opt-in browser policy. Web Locks provide atomic same-origin same-session exclusion. */
export interface StakeBrowserSessionLease { readonly kind: 'WEB_LOCKS' }
export class SessionLease {
  #state: 'UNACQUIRED' | 'HELD' | 'DESTROYED' = 'UNACQUIRED';
  #release: (() => void) | undefined;
  #abort = new AbortController();
  #isDestroyed(): boolean { return this.#state === 'DESTROYED'; }
  async acquire(base: string, sessionID: string, signal?: AbortSignal): Promise<void> {
    if (this.#isDestroyed()) throw new StakeSdkError(CATEGORY.LIFECYCLE, CODE.DESTROYED, 'Client destroyed');
    if (signal?.aborted) throw new StakeSdkError(CATEGORY.ABORTED, CODE.REQUEST_ABORTED, 'Lease acquisition aborted');
    if (this.#state === 'HELD') return;
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.locks || !globalThis.crypto?.subtle) {
      throw new StakeSdkError(CATEGORY.SESSION, CODE.LEASE_UNAVAILABLE, 'Browser Web Locks unavailable');
    }
    const controller = this.#abort;
    const aborted = (): StakeSdkError => this.#isDestroyed()
      ? new StakeSdkError(CATEGORY.LIFECYCLE, CODE.DESTROYED, 'Client destroyed')
      : new StakeSdkError(CATEGORY.ABORTED, CODE.REQUEST_ABORTED, 'Lease acquisition aborted');
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
          if (!lock) { reject(new StakeSdkError(CATEGORY.SESSION, CODE.LEASE_CONFLICT, 'Session already leased')); return; }
          this.#state = 'HELD';
          resolve();
          await held;
        }).catch(() => reject(new StakeSdkError(CATEGORY.SESSION, CODE.LEASE_UNAVAILABLE, 'Lease request failed')));
      }), interruption]);
    } finally {
      signal?.removeEventListener('abort', forward);
      if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
      if (!this.#isDestroyed() && controller.signal.aborted) this.#abort = new AbortController();
    }
  }
  destroy(): void {
    this.#state = 'DESTROYED';
    this.#abort.abort();
    this.#release?.();
    this.#release = undefined;
  }
}
