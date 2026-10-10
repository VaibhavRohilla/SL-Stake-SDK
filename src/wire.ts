import type { StakeSessionId, StakeLanguage, StakeBetMode, StakeEventId, StakeGameId, StakeGameVersion, StakeReplayEventId } from './domain.js';
import type { StakeAmountMicros, StakeCurrencyCode } from './money.js';
import { ENDPOINT } from './protocol.js';
import { OPERATION } from './vocabulary.js';
import { invalid } from './errors.js';
interface StakeAuthenticateRequest { readonly sessionID: StakeSessionId; readonly language: StakeLanguage }
interface StakePlayRequest { readonly sessionID: StakeSessionId; readonly amount: StakeAmountMicros; readonly mode: StakeBetMode; readonly currency: StakeCurrencyCode }
interface StakeEventRequest { readonly sessionID: StakeSessionId; readonly event: StakeEventId }
interface StakeEndRoundRequest { readonly sessionID: StakeSessionId }
export type StakeEndpointRequest =
  | { readonly operation: typeof OPERATION.AUTHENTICATE; readonly body: StakeAuthenticateRequest }
  | { readonly operation: typeof OPERATION.PLAY; readonly body: StakePlayRequest }
  | { readonly operation: typeof OPERATION.EVENT; readonly body: StakeEventRequest }
  | { readonly operation: typeof OPERATION.END_ROUND; readonly body: StakeEndRoundRequest }
  | { readonly operation: typeof OPERATION.REPLAY; readonly identity: {
      readonly game: StakeGameId; readonly version: StakeGameVersion; readonly mode: StakeBetMode; readonly event: StakeReplayEventId } };
export function requestPath(request: StakeEndpointRequest): string {
  switch (request.operation) {
    case OPERATION.AUTHENTICATE: return ENDPOINT.AUTH;
    case OPERATION.PLAY: return ENDPOINT.PLAY;
    case OPERATION.EVENT: return ENDPOINT.EVENT;
    case OPERATION.END_ROUND: return ENDPOINT.END;
    case OPERATION.REPLAY: return `${ENDPOINT.REPLAY}/${[request.identity.game, request.identity.version, request.identity.mode, request.identity.event].map(value => {
      if (value === '.' || value === '..') invalid('replay path identity');
      return encodeURIComponent(value);
    }).join('/')}`;
  }
}
