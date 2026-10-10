import { text, stakeLanguage, stakeDevice, stakeSessionId, stakeGameId, stakeGameVersion, stakeBetMode, stakeReplayEventId, STAKE_LANGUAGE, STAKE_DEVICE } from './domain.js';
import type { StakeLanguage, StakeDevice, StakeSessionId, StakeGameId, StakeGameVersion, StakeBetMode, StakeReplayEventId } from './domain.js';
import { invalid } from './errors.js';
import { stakeAmountMicros, stakeCurrencyCode } from './money.js';
import type { StakeAmountMicros, StakeCurrencyCode } from './money.js';
export const STAKE_LAUNCH_MODE = Object.freeze({ LIVE: 'LIVE', REPLAY: 'REPLAY' } as const);
export type StakeLaunchMode = typeof STAKE_LAUNCH_MODE[keyof typeof STAKE_LAUNCH_MODE];
interface LaunchContext {
  readonly rgsUrl: string;
  readonly lang: StakeLanguage;
  readonly device: StakeDevice;
  readonly social: boolean;
}
export interface StakeLiveLaunch extends LaunchContext {
  readonly kind: typeof STAKE_LAUNCH_MODE.LIVE;
  readonly sessionID: StakeSessionId;
}
export interface StakeReplayLaunch extends LaunchContext {
  readonly kind: typeof STAKE_LAUNCH_MODE.REPLAY;
  readonly game: StakeGameId;
  readonly version: StakeGameVersion;
  readonly mode: StakeBetMode;
  readonly event: StakeReplayEventId;
  readonly currency?: StakeCurrencyCode;
  readonly amount?: StakeAmountMicros;
}
export type StakeLaunch = StakeLiveLaunch | StakeReplayLaunch;
export interface StakeLaunchOptions { readonly allowHttp?: boolean }
export function providerUrl(input: string, allowHttp = false): string {
  const bare = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
  let url: URL;
  try { url = new URL(bare.test(input) ? `https://${input}` : input); }
  catch { return invalid('rgs_url'); }
  if ((url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash) invalid('rgs_url');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}
/** Accepts an absolute URL, query string, URL, or URLSearchParams; copies and validates immediately. */
export function parseStakeLaunch(input: unknown, options: StakeLaunchOptions = {}): StakeLaunch {
  let params: URLSearchParams;
  if (input instanceof URLSearchParams) params = new URLSearchParams(input);
  else if (input instanceof URL) params = new URLSearchParams(input.search);
  else if (typeof input === 'string') {
    try { params = input.startsWith('?') ? new URLSearchParams(input) : new URL(input).searchParams; }
    catch { return invalid('launch'); }
  } else return invalid('launch');
  for (const key of ['sessionID', 'rgs_url', 'replay', 'game', 'version', 'mode', 'event', 'currency', 'amount', 'lang', 'device', 'social']) {
    if (params.getAll(key).length > 1) invalid(`duplicate launch ${key}`);
  }
  const flag = params.get('replay');
  if (flag !== null && flag !== 'true' && flag !== 'false') invalid('replay flag');
  const lang = params.get('lang');
  const device = params.get('device');
  const social = params.get('social');
  if (social !== null && social !== 'true' && social !== 'false') invalid('social');
  const context: LaunchContext = {
    rgsUrl: providerUrl(text(params.get('rgs_url'), 'rgs_url'), options.allowHttp),
    lang: lang === null ? STAKE_LANGUAGE.EN : stakeLanguage(lang),
    device: device === null ? STAKE_DEVICE.DESKTOP : stakeDevice(device),
    social: social === 'true',
  };
  if (flag === 'true') {
    if (params.has('sessionID')) invalid('mixed live/replay launch');
    const amount = params.get('amount');
    if (amount !== null && !/^(0|[1-9][0-9]*)$/.test(amount)) invalid('replay amount');
    const currency = params.get('currency');
    return Object.freeze({ ...context, kind: STAKE_LAUNCH_MODE.REPLAY,
      game: stakeGameId(params.get('game')), version: stakeGameVersion(params.get('version')),
      mode: stakeBetMode(params.get('mode')), event: stakeReplayEventId(params.get('event')),
      ...(currency === null ? {} : { currency: stakeCurrencyCode(currency) }),
      ...(amount === null ? {} : { amount: stakeAmountMicros(Number(amount)) }),
    });
  }
  if (['game', 'version', 'mode', 'event', 'amount'].some(key => params.has(key))) invalid('replay fields in live launch');
  return Object.freeze({ ...context, kind: STAKE_LAUNCH_MODE.LIVE, sessionID: stakeSessionId(params.get('sessionID')) });
}
