// Internal lifecycle vocabulary; no consumer dependency on these implementation states.
export const OPERATION = Object.freeze({ AUTHENTICATE: 'AUTHENTICATE', PLAY: 'PLAY', EVENT: 'EVENT', END_ROUND: 'END_ROUND', REPLAY: 'REPLAY' } as const);
export type Operation = typeof OPERATION[keyof typeof OPERATION];
export const MUTATION = Object.freeze({ NONE: 'NONE', PLAY: 'PLAY', EVENT: 'EVENT', END_ROUND: 'END_ROUND' } as const);
export const LIFECYCLE = Object.freeze({ ACTIVE: 'ACTIVE', DESTROYED: 'DESTROYED' } as const);
export const JOURNAL = Object.freeze({ UNLOADED: 'UNLOADED', LOADED: 'LOADED', DESTROYED: 'DESTROYED' } as const);
export const LEASE = Object.freeze({ UNACQUIRED: 'UNACQUIRED', HELD: 'HELD', DESTROYED: 'DESTROYED' } as const);
export const INTERRUPTION = Object.freeze({ NONE: 'NONE', ABORTED: 'ABORTED', TIMEOUT: 'TIMEOUT' } as const);
export const SERIALIZATION = Object.freeze({ IDLE: 'IDLE', BUSY: 'BUSY' } as const);
export const PROVIDER_FAILURE_KIND = Object.freeze({ KNOWN: 'KNOWN', UNRECOGNIZED: 'UNRECOGNIZED', MALFORMED: 'MALFORMED' } as const);
