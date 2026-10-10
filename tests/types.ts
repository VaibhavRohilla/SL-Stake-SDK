import { stakeAmountMicros, stakeBetMode, stakeEventId, StakeSdkError, STAKE_ERROR_CATEGORY, STAKE_ERROR_CODE, STAKE_DISPATCH_PHASE } from '../src/index.js';
import type { StakeReplayClient, StakeLiveClient, StakeAmountMicros, StakeCurrencyCode, StakeBetMode, StakePlayInput,
  StakeSession, StakeBetId, StakeReplayEventId, StakeSdkFailure, StakeReplayClientOptions, StakeReplayLaunch,
  StakeGameStateCodec } from '../src/index.js';
type Assert<T extends true> = T;
export type ReplayNoPaidMethods = Assert<Extract<keyof StakeReplayClient<null>, 'play' | 'recordEvent' | 'endRound' | 'authenticate'> extends never ? true : false>;
export type UnbrandedNumberRejected = Assert<number extends StakeAmountMicros ? false : true>;
export type UnbrandedCurrencyRejected = Assert<string extends StakeCurrencyCode ? false : true>;
export type UnbrandedModeRejected = Assert<string extends StakeBetMode ? false : true>;
export type LiveHasPaidMethods = Assert<'play' | 'recordEvent' | 'endRound' extends keyof StakeLiveClient<null> ? true : false>;
/** Compile-time consumer proofs; this function is never executed. */
export function publicTypeProofs(live: StakeLiveClient<null>, replay: StakeReplayClient<null>, session: StakeSession<null>,
  raw: string, betID: StakeBetId, replayEvent: StakeReplayEventId, failure: StakeSdkFailure,
  launch: StakeReplayLaunch, codec: StakeGameStateCodec<null>): void {
  // @ts-expect-error External numeric primitives need amount validation.
  const amount: StakeAmountMicros = 1;
  // @ts-expect-error Arbitrary external currency strings need vocabulary validation.
  const currency: StakeCurrencyCode = raw;
  // @ts-expect-error Game-defined modes need identifier validation.
  const mode: StakeBetMode = raw;
  // @ts-expect-error A caller cannot choose live currency.
  const play: StakePlayInput = { amount: stakeAmountMicros(1), mode: stakeBetMode('BASE'), currency: 'USD' };
  // @ts-expect-error Replay has no paid mutation capability.
  replay.play(play);
  // @ts-expect-error Replay has no authentication capability.
  replay.authenticate();
  // @ts-expect-error Replay has no checkpoint capability.
  replay.recordEvent(betID, stakeEventId('one'));
  // @ts-expect-error Replay has no finalization capability.
  replay.endRound(betID);
  // @ts-expect-error Replay identity is distinct from a live checkpoint.
  live.recordEvent(betID, replayEvent);
  // @ts-expect-error Replay cannot accept live journal policy.
  const journal: StakeReplayClientOptions<null> = { launch, codec, pendingDispatchStorage: localStorage };
  // @ts-expect-error Replay cannot accept live lease policy.
  const lease: StakeReplayClientOptions<null> = { launch, codec, sessionLease: { kind: 'WEB_LOCKS' } };
  // @ts-expect-error Replay has no live diagnostics option.
  const diagnostic: StakeReplayClientOptions<null> = { launch, codec, diagnostics() {} };
  if (session.round?.active) {
    const recoveredAmount: StakeAmountMicros = session.round.amount;
    void recoveredAmount;
  } else if (session.round) {
    // @ts-expect-error A completed authenticate round may omit its amount.
    const completedAmount: StakeAmountMicros = session.round.amount;
    void completedAmount;
  }
  if (failure.category === STAKE_ERROR_CATEGORY.AMBIGUOUS_PAID_DISPATCH && failure.code === STAKE_ERROR_CODE.PAID_DISPATCH_UNCERTAIN) {
    const pending = failure.pending, reason = failure.reason;
    void pending; void reason;
  }
  // @ts-expect-error Paid ambiguity must carry exact reconciliation facts and a reason.
  const ambiguous: StakeSdkFailure = { category: STAKE_ERROR_CATEGORY.AMBIGUOUS_PAID_DISPATCH, code: STAKE_ERROR_CODE.PAID_DISPATCH_UNCERTAIN, dispatch: STAKE_DISPATCH_PHASE.MAY_HAVE_DISPATCHED };
  // @ts-expect-error Category and code must agree.
  new StakeSdkError({ category: STAKE_ERROR_CATEGORY.TIMEOUT, code: STAKE_ERROR_CODE.NETWORK_FAILURE, dispatch: STAKE_DISPATCH_PHASE.NOT_DISPATCHED }, 'invalid');
  void amount; void currency; void mode; void journal; void lease; void diagnostic; void ambiguous;
}
