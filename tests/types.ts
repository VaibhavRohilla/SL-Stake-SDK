import type { StakeReplayClient, StakeAmountMicros, StakeLiveClient } from '../src/index.js';
type Assert<T extends true> = T;
export type ReplayNoPaidMethods = Assert<Extract<keyof StakeReplayClient<null>, 'play' | 'recordEvent' | 'endRound' | 'authenticate'> extends never ? true : false>;
export type UnbrandedNumberRejected = Assert<number extends StakeAmountMicros ? false : true>;
export type LiveHasPaidMethods = Assert<'play' | 'recordEvent' | 'endRound' extends keyof StakeLiveClient<null> ? true : false>;
