# @fnx/stake-sdk

Standalone Stake Engine protocol client for browser and Node applications. It owns launch validation, live authentication/play/recovery/event/finalization, replay acquisition, exact Stake amounts, response validation and request lifetime. It has no runtime dependencies.

Games own presentation, game-state meaning, payout interpretation and any conversion into their own money representation. This package neither calculates winnings nor binds a game engine.

## Install and build

Install the qualified local tarball with `npm install /path/to/fnx-stake-sdk-0.1.0.tgz`. The package is private and unpublished; FNX retains commercial licensing authority.

For development: `npm ci`, then `npm run doctor`, `npm test`, `npm run test:integration`, `npm run test:browser`, and `npm run pack:verify`. Chromium must be installed (`npx playwright install chromium`). Node 22 or newer is required for development. Browser runtime requires fetch, AbortController and structuredClone; leasing additionally requires a secure context, Web Locks, Web Crypto and localStorage.

## Game-state codec

```ts
import type { StakeGameStateCodec } from '@fnx/stake-sdk';

interface GameState { readonly result: number }
const codec: StakeGameStateCodec<GameState> = {
  parse(input: unknown): GameState {
    if (input === null || typeof input !== 'object' ||
        !('result' in input) || typeof input.result !== 'number') {
      throw new Error('Invalid game state');
    }
    return { result: input.result };
  },
};
```

The SDK validates the provider envelope before calling `parse`. The result must be structured-cloneable plain data (objects, arrays, primitives), not functions, DOM objects, Maps, Sets or class instances. It is copied and recursively frozen before publication. No raw provider JSON is returned.

## Live launch and client

```ts
import { parseStakeLaunch, createStakeLiveClient } from '@fnx/stake-sdk';

const launch = parseStakeLaunch(new URL(window.location.href));
if (launch.kind !== 'LIVE') throw new Error('Expected live launch');
const client = createStakeLiveClient({
  launch, codec, timeoutMs: 30_000,
  sessionLease: { kind: 'WEB_LOCKS' },
});
const abort = new AbortController();
const session = await client.authenticate({ signal: abort.signal });
if (session.round?.active) {
  // Restore/present session.round.state and its authoritative amount/mode/event.
} else {
  const played = await client.play({
    amount: session.config.defaultBetAmount,
    mode: 'BASE', // Your actual Stake-configured mode; SDK has no default mode.
  }, { signal: abort.signal });
  // Your application presents played.round.state.
  if (played.round.active) {
    await client.recordEvent(played.round.betID, 'application:presented');
    await client.endRound(played.round.betID);
  }
}
// On application shutdown, after preserving/reconciling any uncertainty:
client.destroy();
```

Use your own configured mode rather than copying `BASE` blindly. Every live operation is serialized; overlap fails with `BUSY`, without a hidden queue or retry. `getActiveRound({ signal })` refreshes `/wallet/authenticate` and returns the active provider round or null. It does not invent a recovery endpoint. `authenticate` can also inspect the last completed round.

`recordEvent(betID, event)` and `endRound(betID)` require the currently admitted active round. The provider wire associates those operations through sessionID; the SDK validates betID locally and never invents a wire field. `recordEvent` returns the exact echoed checkpoint. `endRound` returns an immutable provider balance. The application decides their timing.

## Replay

```ts
import { parseStakeLaunch, createStakeReplayClient } from '@fnx/stake-sdk';
const launch = parseStakeLaunch(new URL(window.location.href));
if (launch.kind !== 'REPLAY') throw new Error('Expected replay launch');
const replay = createStakeReplayClient({ launch, codec });
const result = await replay.acquire({ signal: abort.signal });
// Present result.state; preserve result.payoutMultiplier/costMultiplier as supplied.
replay.destroy();
```

Replay has no authenticate/play/event/end-round methods, session lease or mutation journal. Launch amount and currency are optional display facts; absence remains absence. They are never converted to live wallet facts. Replay identity path segments are encoded individually.

Launch accepts an absolute URL, URL object, query string beginning with `?`, or URLSearchParams. Duplicate governed parameters, malformed replay flags and mixed live/replay identity are rejected. Bare DNS rgs_url hosts become HTTPS. Absolute HTTP requires the parser's explicit `{ allowHttp: true }` option for local testing. URL credentials, query and hash are rejected. Launch tokens are private inputs and must not be logged by applications.

## Money and currency

**1 Stake major unit = 1_000_000 micros.** All authoritative amounts are nonnegative safe integers. `stakeAmountMicros(1_000_000)` creates a validated branded amount. Fractions, negative values, NaN, Infinity and unsafe integers fail; nothing is rounded.

`authenticate.config.defaultBetLevel` is interpreted exclusively as a micros amount and exposed as `session.config.defaultBetAmount`. It must be an exact member of `betLevels`. There is no index interpretation, clamping or nearest-value selection. Play requires an exact advertised bet level.

`session.balance.currency` is the only live currency authority. Play always sends it. There is no default currency, optional-currency retry or conversion into a game's money type. Currency syntax accepts compact uppercase provider codes including social currencies; this does not claim they are all ISO fiat currencies.

## Uncertain dispatch and recovery

Once fetch is invoked for paid play, the request may have reached Stake. Network failure, timeout, post-dispatch abort/destroy, malformed JSON/envelope or codec failure produces `AMBIGUOUS_PAID_DISPATCH`. Its typed `reason` identifies the underlying category. The client never retries a request.

Further mutations are blocked with `RECONCILIATION_REQUIRED`. Call `getActiveRound` or `authenticate` to inspect authoritative truth. A different provider betID matching pending amount, mode and authenticated currency can reconcile play. The previous completed round cannot resolve it. **Null round does not establish nonacceptance** and leaves the fence in place. Unresolved cases require provider/operator truth; recreating a client or clearing storage is not reconciliation.

Only a validated known business rejection on HTTP 4xx proves a play was not accepted. Arbitrary 401/403 bodies, unknown codes and 5xx are not used as proof. Event and end-round uncertainty also fences further mutations; recovery requires the same round with the echoed event or explicit inactive status, respectively. No null-round inference clears end-round uncertainty.

With browser leasing enabled, a non-secret pending mutation marker is stored in localStorage **before dispatch**, keyed by a SHA-256 digest of provider base/session identity. It survives client destroy and tab closure; only proven rejection, validated success or matching reconciliation removes it. Credentials are not persisted. Corrupt/unavailable storage fails closed. Other runtimes may inject `pendingDispatchStorage` with getItem/setItem/removeItem methods. Without that option and without browser leasing, pending truth is instance-local: retain the client across uncertainty; no cross-process/reload guarantee is claimed. Persistent storage is a safety journal, not a financial ledger or provider idempotency mechanism.

## Abort, timeout and destruction

All async operations accept `{ signal }`. The timeout (default 30 seconds) covers both fetch and response-body consumption. An SDK-owned race bounds completion even when an injected fetch ignores abort. Destroy is idempotent, aborts owned requests, releases the browser lock and clears exposed session state. Late responses/codecs cannot republish state. Separate clients have separate sessions, controllers, clocks, pending mutations and diagnostics.

## Browser session policy

Session lease is **opt-in**. `{ kind: 'WEB_LOCKS' }` acquires one exclusive browser lock per provider/session within an origin before authentication, rejects another same-session client with `LEASE_CONFLICT`, and holds it until destroy or tab termination. The browser automatically releases locks when the owning context dies; there is no heartbeat TTL or stale localStorage lease to steal. No process-global lease authority is introduced. Different origins/devices are outside this policy; no client library can enforce operator-wide session exclusivity.

Unsupported browser facilities fail with `LEASE_UNAVAILABLE`; Node applications leave the browser policy unset. Replay cannot enable it. Browser policy is distinct from Stake protocol.

## Typed failures and diagnostics

```ts
import { StakeSdkError, STAKE_ERROR_CATEGORY } from '@fnx/stake-sdk';
try {
  await client.getActiveRound();
} catch (error) {
  if (!(error instanceof StakeSdkError)) throw error;
  switch (error.category) {
    case STAKE_ERROR_CATEGORY.AMBIGUOUS_PAID_DISPATCH:
      // Keep mutations disabled; reconcile from provider truth.
      break;
    case STAKE_ERROR_CATEGORY.ABORTED:
      break;
    default:
      // Handle category/code, not message text.
      break;
  }
}
```

Errors expose category, code, dispatch phase, optional providerCode and optional underlying reason. Provider messages/raw payloads/transport causes are excluded to prevent credential leakage. Optional `diagnostics(event)` receives only operation/lifecycle/category metadata; observer exceptions cannot change protocol truth. There is no global logger.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for evidence classifications, deliberate protocol rules, conflicts and qualification limits. Independent hostile audit and real-provider transaction proof remain separate from these mocked HTTP/browser/package lanes.
