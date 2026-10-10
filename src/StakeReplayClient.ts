import { invalid } from './errors.js';
import { STAKE_LAUNCH_MODE, providerUrl, text } from './launch.js';
import type { StakeReplayLaunch } from './launch.js';
import { ENDPOINT, parseReplay } from './protocol.js';
import type { StakeGameStateCodec, StakeReplayResult } from './protocol.js';
import { Requests } from './request.js';
import type { StakeRequestOptions, StakeNetworkOptions } from './request.js';
export interface StakeReplayClientOptions<T> extends StakeNetworkOptions {
  readonly launch: StakeReplayLaunch; readonly codec: StakeGameStateCodec<T>;
}
export class StakeReplayClient<T> {
  readonly #requests: Requests;
  readonly #path: string;
  readonly #codec: StakeGameStateCodec<T>;
  constructor(options: StakeReplayClientOptions<T>) {
    if (options.launch.kind !== STAKE_LAUNCH_MODE.REPLAY) invalid('replay launch');
    if (!options.codec || typeof options.codec.parse !== 'function') invalid('codec');
    this.#codec = Object.freeze({ parse: options.codec.parse.bind(options.codec) });
    this.#requests = new Requests(providerUrl(options.launch.rgsUrl, true), options);
    this.#path = `${ENDPOINT.REPLAY}/${[options.launch.game, options.launch.version, options.launch.mode, options.launch.event]
      .map(value => { text(value, 'replay identity'); if (value === '.' || value === '..') invalid('replay path identity'); return encodeURIComponent(value); }).join('/')}`;
  }
  acquire(options: StakeRequestOptions = {}): Promise<StakeReplayResult<T>> {
    return this.#requests.run('REPLAY', this.#path, undefined, input => parseReplay(input, this.#codec), options);
  }
  destroy(): void { this.#requests.destroy(); }
}
export function createStakeReplayClient<T>(options: StakeReplayClientOptions<T>): StakeReplayClient<T> {
  return new StakeReplayClient(options);
}
