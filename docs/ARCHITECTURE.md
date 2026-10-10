# Stake SDK architecture and protocol authority

STAKE-SDK-1: **IMPLEMENTED / READY FOR HOSTILE AUDIT**. One standalone package, zero runtime dependencies. This document is the repository's canonical maintainer record. Independent hostile audit is the next batch; no commercial freeze/certification or real game binding is claimed.

## Source identity and evidence

Read-only historical source: SL-Engine `main` / `b3ceecace4704b56fdde5d77f9eb44785e3c2ed3`, package `packages/stake-dist`. Read StakeSchemas, StakeLaunchParams, StakeTransport, StakeDistribution, StakePendingPaidDispatch, StakeErrorMapper, package manifest and contract fixtures, including walletPlay.currency and authoritativeBetPolicy. Current SL-Engine base `9cd4cd788607fc9f8fdae700eb3a671f1cc86424` / `revampEngine` has user-owned HOST-ACK-1 changes. None are part of this repository or implementation.

The user explicitly admits this standalone batch and defers SL-Engine recertification; that instruction overrides the older next-batch restriction in SL-Engine's current architecture note. SL-Engine itself is not modified.

Upstream sources inspected on 2026-10-10:

- [RGS wallet](https://stake-engine.com/docs/rgs/wallet).
- [Official API authenticate source](https://github.com/engineio/docs/blob/main/src/routes/docs/api/%2Bpage.svx) and endpoint pages beneath that route.
- [Official play source](https://github.com/engineio/docs/blob/main/src/routes/docs/api/play/%2Bpage.svx).
- [Official event source](https://github.com/engineio/docs/blob/main/src/routes/docs/api/event/%2Bpage.svx).
- [Official end-round source](https://github.com/engineio/docs/blob/main/src/routes/docs/api/end-round/%2Bpage.svx).
- [Official replay source](https://github.com/engineio/docs/blob/main/src/routes/docs/api/bet-replay/%2Bpage.svx).
- [Official TS client types](https://github.com/engineio/ts-client/blob/main/src/types.ts).
- [Official web SDK authenticate consumer](https://github.com/engineio/web-sdk/blob/main/packages/components-shared/src/components/Authenticate.svelte).
- [Web Locks request contract](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request).

Upstream references are mutable observations, not a pinned official normative spec. Existing archaeology fixtures use fake credentials and establish implementation behavior, not real provider certification. No new real account transaction was performed.

## Ownership

| Concern | Owner | Boundary |
|---|---|---|
| Launch | parseStakeLaunch | External URL/query → immutable exact live/replay union |
| Live session | StakeLiveClient | Validated session, operation serialization, mutation admission, publication |
| Replay | StakeReplayClient | Unauthenticated replay acquisition only; no live methods |
| HTTP lifetime | Requests (internal) | Fetch/JSON as unknown → one parser; bounded abort/timeout/body/destroy race |
| Provider facts | protocol pure parsers (internal) | Exact immutable amounts, balances, config, round and response envelopes |
| Game-state meaning | injected StakeGameStateCodec | Application validation; plain data copied/deep-frozen before publication |
| Unresolved mutation | PendingPaidDispatch (internal) | One pending discriminant, optional write-before-dispatch journal; no retry API |
| Browser exclusion | SessionLease (internal) | Opt-in same-origin Web Locks policy, independent of wire validation |

Every client owns its requests, session, mutation and destruction. No mutable global runtime state, schema exports, transport exports, provider registry or renderer dependency exists. Public exports are limited to client creation/classes, launch/money constructors, exact result/config/option types, error vocabulary and diagnostic/policy contracts.

## Protocol classification ledger

| Topic | Classification | Implemented rule/evidence |
|---|---|---|
| Auth endpoint | PROVEN FACT | POST /wallet/authenticate with sessionID; historical transport and upstream docs agree. Language is launch context; no invented mandatory auth field. |
| Active round | PROVEN FACT | Authenticate returns one round or null; use that operation to refresh recovery truth. Preserve last completed round too. |
| Required recovery facts | ARCHITECTURE DECISION | Non-null rounds require safe string/numeric betID, safe micros amount, boolean active, mode and codec state. Missing economics/identity fails closed even where upstream typings make amount optional. |
| Single active round | INFERENCE | Session-scoped event/end and one auth round imply one current unresolved round. SDK serializes operations and admits no second play while active. This is not a claim about every possible future provider flow. |
| Round currency | ARCHITECTURE DECISION | Currency comes from the associated authenticated balance/session. Any supplied round.currency must agree. No synthetic currency. |
| Micros | PROVEN FACT | Historical safe-integer schema and accepted production contract: 1 major unit = 1,000,000 micros; nonnegative safe integers only. |
| Default bet | ARCHITECTURE DECISION | defaultBetLevel is micros, exposed as defaultBetAmount, exact member of betLevels. Historical source supports it; some older upstream examples described index semantics. Index mode is deliberately rejected. |
| Required play currency | ARCHITECTURE DECISION | Always send authenticated balance.currency with sessionID, amount and mode. Accepted handoff/historical transport requires this. Official play example inspected omits currency, so official guarantee is NOT claimed. |
| Currency syntax | ARCHITECTURE DECISION | Nonempty uppercase compact provider code, 2–12 alphanumeric characters. Includes social/crypto codes, not a frozen fiat ISO whitelist. Authentication supplies identity; SDK never selects a currency. |
| Bet admission | ARCHITECTURE DECISION | min/max and positive step validated; unique advertised levels in range; play requires exact membership. No rounded amount or title-specific mode default. |
| Round ID | PROVEN FACT + DECISION | Provider uses betID. Historical schema accepts numeric/string identities. Preserve supplied form; safe numeric/nonempty string required, never synthesize. |
| Event wire | PROVEN FACT | POST /bet/event with sessionID and event. Response echoes event. Round is session-scoped; betID is required/checks locally, not sent as an invented field. |
| End wire | PROVEN FACT | POST /wallet/end-round with sessionID; returns balance. Locally require current active betID. SDK does not choose presentation timing. |
| Replay | PROVEN FACT | Unauthenticated GET /bet/replay/{game}/{version}/{mode}/{event}; state plus payout/cost multipliers. Amount/currency launch display metadata are optional in current upstream docs. Old slot adapter required currency for engine Money; that coupling is rejected. |
| Multipliers | ARCHITECTURE DECISION | Preserve finite nonnegative provider multiplier values; no scaling or economic calculation. They are not StakeAmountMicros. |
| Event null | PROVEN FACT | Official web SDK round example uses event:null. Preserve null independently of absent/unset and never invent a checkpoint. |
| Jurisdiction shape | PROVEN FACT / CONFLICT | Official TS client declares root jurisdictionFlags; official web consumer reads config.jurisdiction. Preserve both separately if supplied, validate each, reject conflicting overlapping facts. Neither fills the other. No compatibility interpretation or default flags. Exact provider spelling disabledSlamstop/disabledBuyFeature is used. |
| Business rejection | PROVEN FACT + DECISION | Historical known ERR_VAL/IPB/IS/ATE/GLE/LOC prove nonacceptance only on validated HTTP 4xx error-string envelopes. Unknown/5xx/malformed bodies remain uncertain. No nested legacy parser. |
| Null after uncertain dispatch | UNRESOLVED QUESTION | No evidence proves it means nonacceptance. Keep pending fence; do not clear/retry. |
| Matching reconciliation | INFERENCE + DECISION | Same session, new betID, exact pending amount/mode/currency under exclusive ownership supports adoption. Previous betID cannot reconcile. No provider idempotency key/correlation is invented. |
| Finalization uncertainty | ARCHITECTURE DECISION | No resend. Same betID with explicit inactive truth resolves end; echoed checkpoint resolves event. Null cannot clear uncertainty. |
| Browser lease | ARCHITECTURE DECISION | Opt-in Web Locks; no TTL/heartbeat or storage lease race. Browser releases lock on context termination; stale contexts cannot steal ownership. Unsupported facilities fail closed. Scope is one browser origin/provider/session. |
| Reload uncertainty | ARCHITECTURE DECISION | Browser lease enables localStorage pending journal; optional injected storage in other runtimes. Write before fetch, clear only after validated truth, retain on destroy. SHA-256 key; no credential persistence. Default nonbrowser state is instance-local. |

## Dispatch and lifetime

Public paid status: READY → DISPATCHING → CONFIRMED, or AMBIGUOUS → RECONCILING → CONFIRMED/AMBIGUOUS; destruction is terminal DESTROYED. Requests independently carry NOT_DISPATCHED → MAY_HAVE_DISPATCHED → RESPONSE_RECEIVED. Fetch invocation is the conservative possible-dispatch boundary; its rejection cannot prove the network never sent bytes.

Validation/lease/journal failure or an already-aborted signal before fetch does not create ambiguity. Paid failures after possible dispatch wrap the typed underlying category in AMBIGUOUS_PAID_DISPATCH. No string matching, automatic retry, retry flag or second wire shape exists. Pending facts are retained through reconciliation failure. Event/end uncertainty also blocks further mutations.

All operations support AbortSignal. Network timeout includes response-body parsing. Owned abort races fence even fetch implementations ignoring signals; pre-/post-parse and publication checks reject destroy/reentrant codecs. Web Locks ifAvailable cannot be combined with platform signal: the nonqueued callback is manually fenced against abort/destroy. Application diagnostic exceptions are deliberately isolated because observers do not determine protocol truth.

Immutable session snapshots remain historical provider facts until a validated replacement. Concurrent live operations fail BUSY instead of racing. Requests use redirect:error, credentials:omit and cache:no-store, and do not retain raw response/cause/provider messages in public errors.

## Removed/rejected architecture

No code was ported wholesale. Rejected: DistributionAdapter, renderer/engine imports, engine Money conversion, creditedMoney, mapped books/steps, slot event cursor, synthetic betID, recovery wager fallback, USD default, default-bet index/amount dual interpretation, currency fallback/retry, universal provider hierarchy, heartbeat/localStorage lease ownership, legacy nested error parser. Historical source remains only in its original repository; it is not copied here.

## Capability envelope and exclusions

Supported batch: live/replay launch, authentication, one active round recovery, paid play, generic event checkpoint, end-round, replay, exact immutable typed game state, safe amounts/currency/config, typed errors, abort/timeout/destroy, uncertain dispatch/reconciliation, optional browser exclusivity and pending journal, ESM/DTS and package-consumer proofs.

Intentional exclusions: generic provider API, live wallet balance polling, game-specific betModes bags, custom server DTO passthrough, operator-wide cross-device lock, financial ledger, provider idempotency invention, presentation/economic mapping, codec Maps/Sets/class instances, real provider credentials and deployment/publication. These are not hidden fallback paths. Applications bind this SDK to their game independently.

## Qualification and next batch

Permanent behavior tests cover launch/money/currency/config, auth/play/recovery/event/end, codec immutability, typed rejection/ambiguity, no retry, stalled bodies/timeouts, abort/destroy/late/reentrant publication, operation overlap, persistence/storage faults, and isolated clients. HTTP integration uses real platform fetch against a local fixture server. Chromium proves native module/fetch interactions, lifecycle fencing, cross-tab lock/release, journal recreation and replay bypass. Packed tarball proof installs into an external temporary consumer, compiles DTS/public imports, runs generated ESM, and rejects private subpath imports.

Commands: build, typecheck, lint, test, test:integration, test:browser, test:consumer, pack:verify, doctor. Doctor is static only. pack:verify delegates to the one consumer/package proof implementation.

Remaining evidence: capture/archive a real live play confirming required currency; confirm any official discrepancy via an intentional protocol correction rather than a dual parser. No real-provider qualification, independent hostile audit, SL-Engine binding, H2-C/H2-D or commercial approval is claimed. Next batch is independent hostile audit of this exact SDK candidate.

### Implementation qualification (2026-10-10)

| Command | Result |
|---|---|
| npm run build | PASS (ESM and DTS) |
| npm run typecheck | PASS (including public live/replay type assertions) |
| npm run lint | PASS |
| npm run doctor | PASS (static only) |
| npm test | PASS (70 behavior tests) |
| npm run test:integration | PASS (1 real local HTTP/platform-fetch scenario) |
| npm run test:browser | PASS (4 Chromium scenarios) |
| npm run test:consumer | PASS (external installed tarball, DTS compile, ESM execution, private-export denial) |
| npm run pack:verify | PASS (delegates to the same package/consumer proof) |
| git diff --check | PASS |
| real Stake live transaction | NOT RUN (no credentials or archived new live transaction) |
| independent hostile audit | NOT RUN (next batch) |
| SL-Engine H2-C/H2-D | NOT RUN (explicitly deferred) |

These results qualify only this standalone implementation's local mocked-provider envelope. Chromium tests execute native browser modules/HTTP and cross-tab behavior; they are not real-provider or commercial certification. Final candidate is identified by the repository implementation commit, not by a mutable test-count claim.
