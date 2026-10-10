import { parseStakeLaunch, createStakeLiveClient, createStakeReplayClient } from '../src/index.js';
import type { StakeGameStateCodec, StakeLiveClientOptions } from '../src/index.js';
export interface State { readonly value: number }
export const codec: StakeGameStateCodec<State> = { parse(input) {
  if (input === null || typeof input !== 'object' || !('value' in input) || typeof input.value !== 'number') throw new Error('invalid state');
  return { value: input.value };
} };
export const balance = { amount: 10_000_000, currency: 'USD' };
export const config = { minBet: 100_000, maxBet: 10_000_000, stepBet: 100_000,
  defaultBetLevel: 1_000_000, betLevels: [100_000, 1_000_000, 10_000_000] };
export const round = { betID: 'fake-round-1', amount: 1_000_000, active: true, mode: 'BASE',
  state: { value: 7 }, payout: 2_000_000, payoutMultiplier: 2 };
export const auth = { balance, config, round: null };
export const played = { balance, round };
export function response(input: unknown, status = 200): Response { return Response.json(input, { status }); }
export function live(fetch: typeof globalThis.fetch, options: Omit<StakeLiveClientOptions<State>, 'launch' | 'codec' | 'fetch'> = {}) {
  const launch = parseStakeLaunch('?sessionID=fake-session&rgs_url=https://fake-rgs.example');
  if (launch.kind !== 'LIVE') throw new Error('fixture');
  return createStakeLiveClient({ launch, codec, fetch, ...options });
}
export function replay(fetch: typeof globalThis.fetch) {
  const launch = parseStakeLaunch('?replay=true&rgs_url=https://fake-rgs.example&game=fake-game&version=1&mode=BASE&event=55');
  if (launch.kind !== 'REPLAY') throw new Error('fixture');
  return createStakeReplayClient({ launch, codec, fetch });
}
export function queue(...responses: Response[]): { fetch: typeof globalThis.fetch; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected dispatch');
    return next;
  };
  return { fetch, calls };
}
export function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('uninitialized'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
