import { invalid } from './errors.js';
import { STAKE_LAUNCH_MODE, providerUrl } from './launch.js';
import type { StakeReplayLaunch } from './launch.js';
import { stakeGameId, stakeGameVersion, stakeBetMode, stakeReplayEventId, stakeLanguage, stakeDevice } from './domain.js';
import { requestPath } from './wire.js';
import type { StakeEndpointRequest } from './wire.js';
import { OPERATION } from './vocabulary.js';
import { parseReplayResponse } from './protocol.js';
import type { StakeGameStateCodec, StakeReplayResult } from './protocol.js';
import { Requests } from './request.js';
import type { StakeRequestOptions, StakeNetworkOptions } from './request.js';
export interface StakeReplayClientOptions<T> extends Pick<StakeNetworkOptions, 'fetch' | 'timeoutMs'> {
  readonly launch: StakeReplayLaunch; readonly codec: StakeGameStateCodec<T>;
}
export class StakeReplayClient<T> {
  readonly #requests: Requests;
  readonly #request: Extract<StakeEndpointRequest, { readonly operation: typeof OPERATION.REPLAY }>;
  readonly #codec: StakeGameStateCodec<T>;
  constructor(options: StakeReplayClientOptions<T>) {
    if (options.launch.kind !== STAKE_LAUNCH_MODE.REPLAY) invalid('replay launch');
    if (!options.codec || typeof options.codec.parse !== 'function') invalid('codec');
    this.#codec = Object.freeze({ parse: options.codec.parse.bind(options.codec) });
    this.#requests = new Requests(providerUrl(options.launch.rgsUrl, true), options);
    stakeLanguage(options.launch.lang); stakeDevice(options.launch.device);
    if (typeof options.launch.social !== 'boolean') invalid('social');
    this.#request = Object.freeze({ operation: OPERATION.REPLAY, identity: Object.freeze({
      game: stakeGameId(options.launch.game), version: stakeGameVersion(options.launch.version),
      mode: stakeBetMode(options.launch.mode), event: stakeReplayEventId(options.launch.event),
    }) });
    requestPath(this.#request);
  }
  acquire(options: StakeRequestOptions = {}): Promise<StakeReplayResult<T>> {
    return this.#requests.run(this.#request, input => parseReplayResponse(input, this.#codec), options);
  }
  destroy(): void { this.#requests.destroy(); }
}
export function createStakeReplayClient<T>(options: StakeReplayClientOptions<T>): StakeReplayClient<T> {
  return new StakeReplayClient(options);
}
