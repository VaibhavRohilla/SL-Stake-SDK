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

The SDK validates the provider envelope before calling `parse`. The codec result supports exactly null, booleans, finite numbers, strings, dense arrays and plain objects with enumerable string data properties. The SDK rejects undefined, BigInt, symbols, functions, nonfinite numbers, cycles, sparse/decorated arrays, accessors, hidden properties, Date, Map, Set, ArrayBuffer, typed arrays and class instances before cloning can erase their meaning. Shared acyclic references are supported. Validated results are copied and recursively frozen; caller-owned codec output is never frozen. No raw provider JSON is returned.

## Live launch and client

```ts
import { parseStakeLaunch, createStakeLiveClient, stakeBetMode, stakeEventId, STAKE_LAUNCH_MODE } from '@fnx/stake-sdk';

const launch = parseStakeLaunch(new URL(window.location.href));
if (launch.kind !== STAKE_LAUNCH_MODE.LIVE) throw new Error('Expected live launch');
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
    mode: stakeBetMode('BASE'), // Your actual Stake-configured mode; SDK has no default mode.
  }, { signal: abort.signal });
  // Your application presents played.round.state.
  if (played.round.active) {
    await client.recordEvent(played.round.betID, stakeEventId('application:presented'));
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
import { parseStakeLaunch, createStakeReplayClient, STAKE_LAUNCH_MODE } from '@fnx/stake-sdk';
const launch = parseStakeLaunch(new URL(window.location.href));
if (launch.kind !== STAKE_LAUNCH_MODE.REPLAY) throw new Error('Expected replay launch');
const replay = createStakeReplayClient({ launch, codec });
const result = await replay.acquire({ signal: abort.signal });
// Present result.state; preserve result.payoutMultiplier/costMultiplier as supplied.
replay.destroy();
```

Replay has no authenticate/play/event/end-round methods, session lease or mutation journal. Launch amount and currency are optional display facts; absence remains absence. They are never converted to live wallet facts. Replay identity path segments are encoded individually.

Launch accepts an absolute URL, URL object, query string beginning with `?`, or URLSearchParams. Duplicate governed parameters, malformed replay flags and mixed live/replay identity are rejected. Bare DNS rgs_url hosts become HTTPS. Absolute HTTP requires the parser's explicit `{ allowHttp: true }` option for local testing. URL credentials, query and hash are rejected. Launch tokens are private inputs and must not be logged by applications.

## TYPE AUTHORITY

Untrusted wire JSON enters as `unknown`, passes one endpoint parser, and becomes exact immutable Stake domain facts. Only title state enters `StakeGameStateCodec.parse(input: unknown)`; no provider JSON bags, metadata or raw DTOs enter public results. `StakeSession.id` is the validated session identity: applications must not log it.

Launch normalizes missing lang to `STAKE_LANGUAGE.EN`, missing device to `STAKE_DEVICE.DESKTOP` and missing social to false. Supplied values are strictly validated. Replay amount/currency are optional display metadata; no missing economic facts are invented. Session, bet, mode, event and replay identity types are distinct, with validated public constructors. IDs reject whitespace/control characters without trimming, preserve numeric/string bet ID representation, and impose no unsupported length or UUID restriction.

`StakeRound<T>` discriminates `active: true` with required recovery amount from `active: false` with nullable amount. New play requires amount in either lifecycle (`StakePlayedRound<T>`). Missing checkpoint becomes null; absent payout/cost/payout multiplier facts become null and are never computed. Completed rounds without amount cannot reconcile an uncertain play. A returned inactive zero-payout round permits the next play without an end-round request.

`config.jurisdiction` is the only accepted jurisdiction wire authority and publishes as `session.jurisdiction`, with all flags required. Root `jurisdictionFlags` is the official TS client's own normalized output, not an alternate wire form. `config.gameID`, `config.betModes`, `meta` and unrelated fields are discarded.

`minimumRoundDuration` is an opaque branded `StakeMinimumRoundDuration`: the inspected official sources do not establish its unit. The SDK validates a nonnegative safe integer and preserves it without conversion or timing enforcement. Applications must obtain a provider unit contract before using it for scheduling. This remains an explicit unresolved protocol question, not a milliseconds claim.

Authentication sends exactly sessionID and normalized language, matching both official clients. Play sends exactly sessionID, amount, mode and authenticated currency. Required play currency is the FNX production contract decision supported by official web SDK behavior; current public Play docs and TS client omit it. No alternate request or retry exists. Event sends sessionID/event; end-round sends sessionID. Local bet IDs never enter those payloads.

## Money and currency

**1 Stake major unit = 1_000_000 micros.** All authoritative amounts are nonnegative safe integers. `stakeAmountMicros(1_000_000)` creates a validated branded amount. Fractions, negative values, NaN, Infinity and unsafe integers fail; nothing is rounded.

`authenticate.config.defaultBetLevel` is interpreted exclusively as a micros amount and exposed as `session.config.defaultBetAmount`. It must be an exact member of `betLevels`. There is no index interpretation, clamping or nearest-value selection. Play requires an exact advertised bet level.

`session.balance.currency` is the only live currency authority. Play always sends it. There is no default currency, optional-currency retry or conversion into a game's money type. Currency is a closed 36-code `StakeCurrencyCode` vocabulary exported as `STAKE_CURRENCY_CODE`, including USD, XGC and XSC. Lowercase and unrecognized codes fail closed. The accepted set follows the official TS client; additional codes listed in newer public docs require a deliberate production contract revision.

## Uncertain dispatch and recovery

Once fetch is invoked for paid play, the request may have reached Stake. Network failure, timeout, post-dispatch abort/destroy, malformed JSON/envelope or codec failure produces `AMBIGUOUS_PAID_DISPATCH`. Its discriminated `failure.reason` preserves the exact underlying category/code/dispatch facts; `failure.pending` carries the immutable reconciliation facts. The client never retries a request.

Further mutations are blocked with `RECONCILIATION_REQUIRED`. Call `getActiveRound` or `authenticate` to inspect authoritative truth. A different provider betID matching pending amount, mode and authenticated currency can reconcile play. The previous completed round cannot resolve it. **Null round does not establish nonacceptance** and leaves the fence in place. Unresolved cases require provider/operator truth; recreating a client or clearing storage is not reconciliation.

Only a validated known business rejection on HTTP 4xx proves a play was not accepted. Arbitrary 401/403 bodies, unknown codes and 5xx are not used as proof. Event and end-round uncertainty also fences further mutations; recovery requires the same round with the echoed event or explicit inactive status, respectively. No null-round inference clears end-round uncertainty.

With browser leasing enabled, a non-secret version-1 pending mutation marker is stored in localStorage **before dispatch**, keyed by a SHA-256 digest of provider base/session identity. It survives client destroy and tab closure; only proven rejection, validated success or matching reconciliation removes it. Credentials are not persisted. Corrupt/unavailable storage and missing/unknown journal versions fail closed without deleting the marker. No unversioned journal compatibility parser exists. Other runtimes may inject `pendingDispatchStorage` with getItem/setItem/removeItem methods. Without that option and without browser leasing, pending truth is instance-local: retain the client across uncertainty; no cross-process/reload guarantee is claimed. Persistent storage is a safety journal, not a financial ledger or provider idempotency mechanism.

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

Errors expose safe category/code/dispatch getters and an immutable `failure` union. Known business rejection requires a known `providerCode`; paid uncertainty requires a typed reason and pending mutation. Unknown provider codes are discarded and never prove nonacceptance. Provider messages/raw payloads/transport causes are excluded to prevent credential leakage. Live-only `diagnostics(event)` receives a closed started/finished/failed event union with an exact operation and a required category on failure; observer exceptions cannot change protocol truth. There is no global logger.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for evidence classifications, deliberate protocol rules, conflicts and qualification limits. Independent hostile audit and real-provider transaction proof remain separate from these mocked HTTP/browser/package lanes.
