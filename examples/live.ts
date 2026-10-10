import { parseStakeLaunch, createStakeLiveClient, stakeAmountMicros, StakeSdkError } from '../src/index.js';
import type { StakeGameStateCodec, StakeLiveClient } from '../src/index.js';
interface GameState { readonly steps: readonly number[] }
const codec: StakeGameStateCodec<GameState> = { parse(input) {
  if (input === null || typeof input !== 'object' || !('steps' in input) ||
      !Array.isArray(input.steps) || !input.steps.every((step: unknown) => typeof step === 'number' && Number.isSafeInteger(step))) {
    throw new Error('Invalid title state');
  }
  return { steps: input.steps };
} };
export async function runLaunch(url: URL, signal: AbortSignal): Promise<StakeLiveClient<GameState> | undefined> {
  const launch = parseStakeLaunch(url);
  if (launch.kind !== 'LIVE') return;
  const client = createStakeLiveClient({ launch, codec });
  try {
    const session = await client.authenticate({ signal });
    const recovered = session.round;
    if (recovered?.active) return client; // The application presents/restores the existing state before new play.
    const result = await client.play({ amount: stakeAmountMicros(session.config.defaultBetAmount), mode: 'BASE' }, { signal });
    // Application presents result.round.state, then chooses its own checkpoint.
    if (result.round.active) {
      await client.recordEvent(result.round.betID, 'application:presented', { signal });
      await client.endRound(result.round.betID, { signal });
    }
    return client;
  } catch (error) {
    if (error instanceof StakeSdkError && error.category === 'AMBIGUOUS_PAID_DISPATCH') {
      // Return the fenced client to application ownership; the caller inspects status and reconciles, never resends.
      return client;
    }
    client.destroy();
    throw error;
  }
  // The application owns destroy() after receiving the client, including unresolved recovery.
}
