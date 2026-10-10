# Stake SDK architecture and protocol authority

STAKE-SDK-1 remediation of independently audited base `codex/stake-sdk-1` / `61cd6ce0fa2942bd8d85eb637b0de240d0267444`. That base failed hostile audit. The current candidate consists of uncommitted changes on that base; the old SHA does not identify the new implementation. Independent re-audit and freeze have not been performed. One standalone package, zero runtime dependencies; no real-provider certification, commercial release or game binding is claimed.

## Hostile-audit remediation

- External fetch, response-body and reflection exceptions cannot become provider nonacceptance or alter the owner-established dispatch phase. Request-owned error identity controls propagation; external messages and supplied failure payloads are discarded.
- Validated rejection restores the previous resolved status. Journal cleanup failures after validated success/rejection remain fenced with response-received evidence; destroy remains terminal.
- Array subclasses/custom array prototypes reject before cloning. Provider round and jurisdiction facts are validated and snapshotted before codec callbacks run. Published state carries recursive readonly typing, preserving tuple structure.
- Browser lease acquisition maps platform failures to sanitized typed errors. Actual lock availability determines conflict; exception class/code does not. Storage loading likewise preserves lifecycle truth from its own owner. Reentrant storage callbacks cannot revive a destroyed journal or republish a reconciled session after destroy.
- The exported `fields` record-bag helper was deleted. HTTP parsing uses an unexported scalar field reader that accepts only own data properties; journal parsing narrows required fields directly. No replacement compatibility path or generic bag exists.

Each finding has durable behavior/type regression coverage. This remediation is an implementation pass, not a new independent hostile-audit verdict.

## Source identity and evidence

Historical evidence retained from STAKE-SDK-1: SL-Engine `main` / `b3ceecace4704b56fdde5d77f9eb44785e3c2ed3`, `packages/stake-dist`, established numeric/string bet IDs, required production play currency and amount interpretation of defaultBetLevel. These are historical evidence, not fresh real-provider proof. No SL-Engine source was changed by STAKE-SDK-1T.

Official sources re-inspected on 2026-10-10:

- [API overview](https://github.com/engineio/docs/blob/main/src/routes/docs/api/%2Bpage.svx).
- [Authenticate](https://github.com/engineio/docs/blob/main/src/routes/docs/api/authenticate/%2Bpage.svx).
- [Play](https://github.com/engineio/docs/blob/main/src/routes/docs/api/play/%2Bpage.svx).
- [Event](https://github.com/engineio/docs/blob/main/src/routes/docs/api/event/%2Bpage.svx).
- [End round](https://github.com/engineio/docs/blob/main/src/routes/docs/api/end-round/%2Bpage.svx).
- [Bet replay](https://github.com/engineio/docs/blob/main/src/routes/docs/api/bet-replay/%2Bpage.svx).
- [TS client types](https://github.com/engineio/ts-client/blob/main/src/types.ts) and [client implementation](https://github.com/engineio/ts-client/blob/main/src/client.ts).
- [Web SDK requests](https://github.com/engineio/web-sdk/blob/main/packages/rgs-requests/src/rgs-requests.ts), [Authenticate consumer](https://github.com/engineio/web-sdk/blob/main/packages/components-shared/src/components/Authenticate.svelte), [launch normalization](https://github.com/engineio/web-sdk/blob/main/packages/state-shared/src/stateUrl.svelte.ts), [schema](https://github.com/engineio/web-sdk/blob/main/packages/rgs-fetcher/src/schema.ts). The downloaded web SDK snapshot resolves to `1843d60` (GitHub archive prefix); mutable links are observations, not a pinned normative spec.
- [Public RGS vocabulary](https://stake-engine.com/docs/rgs) and [wallet](https://stake-engine.com/docs/rgs/wallet).

No new real account transaction was performed. Local test credentials are fake. Published documents and client implementations conflict in places; the classifications below prevent claiming universal wire guarantees from one example.

## TYPE AUTHORITY

External wire/storage input is `unknown` → pure parser/validator → exact immutable Stake domain → normal SDK runtime. `unknown` is confined to launch/identity/money validators, response parsers, title codec/plain-data validation and storage/network ingress. No `Record<string, unknown>` remains. Untrusted field values exist only within boundary parsing and must validate before publication. No public generic provider bag, raw wire DTO or schema-library type exists.

Title state has no TypeScript index-signature constraint. Runtime supports exactly null, boolean, finite number, string, dense array and plain object (ordinary or null prototype) with enumerable string data properties. Cycles, undefined, nonfinite numbers, BigInt, symbols/functions, accessors/hidden properties, decorated/sparse arrays, Date/Map/Set/ArrayBuffer/typed arrays/classes, including array subclasses, are rejected before cloning. Shared acyclic references are supported. A validated copy is recursively frozen and published as StakeReadonlyState<T>; nested readonly typing preserves arrays and tuples. Original codec output remains caller-owned.

## Current ownership and dependencies

| Concern | Owner | Dependencies and boundary |
|---|---|---|
| Launch/domain vocabulary | parseStakeLaunch and pure domain/money validators | External input → exact frozen live/replay launch; public validated identity constructors |
| Live session | StakeLiveClient | Requests, codec, PendingPaidDispatch, optional SessionLease; serialization/admission/reconciliation/publication remain local |
| Replay | StakeReplayClient | Requests, codec, validated replay identities; no authentication/mutation/lease/journal/diagnostics public options |
| HTTP lifetime | Requests (internal) | Exact endpoint request union, fetch, timeout/abort/destroy, JSON boundary and endpoint parser |
| Provider facts | protocol pure parsers (internal) | Domain/money validators and title codec; never raw JSON publication |
| Game-state meaning | injected StakeGameStateCodec | Only title owns meaning; SDK validates supported values and returns a frozen copy with recursive readonly types |
| Pending uncertainty | PendingPaidDispatch (internal) | Exact mutation union, synchronous storage and SHA-256 session key; V1 validation, no credentials or retry |
| Browser exclusion | SessionLease (internal) | Opt-in same-origin Web Locks; NONE/WEB_LOCKS policy, no heartbeat/TTL/storage lease |
| Failures/observations | StakeSdkError and live diagnostic callback | Frozen category/code union and exact safe facts; observers cannot determine protocol truth |

One owner remains per concern. The new domain/vocabulary/wire modules contain definitions and pure functions, not additional runtime authorities. No registry, manager, factory, schema dependency, process-global mutable state, renderer or engine binding was introduced. Package root is the only public import path.

## Protocol classification ledger

| Topic | Classification | Accepted rule and evidence |
|---|---|---|
| Auth wire | PROVEN FACT + PRODUCTION CONTRACT DECISION | Both official clients send sessionID/language. FNX sends both, normalizing absent launch lang to en. Public Authenticate docs list only sessionID; mandatory language is not a universal docs claim. |
| Language/device | PROVEN FACT + PRODUCTION CONTRACT DECISION | Accepted vocabularies are the TS client's 16 languages and desktop/mobile. Defaults en/desktop match its implementation. Public RGS docs additionally list da; no production support is inferred from that discrepancy. |
| Social | PROVEN FACT + PRODUCTION CONTRACT DECISION | Official web SDK checks social === true; absent → false. SDK rejects other supplied text instead of coercing it. Social is launch context, not a substitute for authenticated jurisdiction. |
| Currency | PROVEN FACT + PRODUCTION CONTRACT DECISION | Closed 36-code vocabulary from official TS client, including XGC/XSC. Newer public RGS docs list additional codes (including XEC); no archived/live FNX evidence admits them in this candidate. Extension requires deliberate contract change; no permissive regex remains. |
| Session/identities | PRODUCTION CONTRACT DECISION | Branded exact session, numeric/string bet, game-defined mode, event and replay IDs. Reject empty/trimmed/control strings without rewriting; numeric bet ID is nonnegative safe integer. No arbitrary max length or UUID constraint. |
| Round lifecycle | PROVEN FACT + PRODUCTION CONTRACT DECISION | Auth may return active or last completed round. Active requires amount/ID/mode/state. Completed amount may be omitted (TS client optionality) and normalizes to null. New play requires amount even when completed, protecting exact request association. |
| Missing round facts | PRODUCTION CONTRACT DECISION | Omitted/null event normalizes to null (no checkpoint supplied); omitted payout/multipliers normalize to null (fact unavailable). Supplied malformed facts reject. No event 0 or economics are invented. |
| Round currency | PRODUCTION CONTRACT DECISION | Associated authenticated balance is currency authority; supplied round.currency must agree. |
| Money | PROVEN FACT | Six-decimal Stake micros. All amounts are nonnegative safe integers with no rounding/coercion. |
| Default bet | PRODUCTION CONTRACT DECISION | defaultBetLevel wire → amount → defaultBetAmount; exact member of betLevels. Current docs/web SDK examples support amount semantics. Historical index descriptions remain rejected evidence history, not a second parser. |
| Bet admission | PRODUCTION CONTRACT DECISION | Positive min/step, min ≤ max, nonempty unique levels in range, default membership; preserve provider order. Exact level membership is the single play admission predicate. No competing modulo/step-only path. |
| Play currency | PRODUCTION CONTRACT DECISION | FNX sends sessionID/amount/mode/currency, deriving currency from session. Historical integration and official web SDK requestBet support it. Public Play docs and TS client omit currency. No dual shape/retry or caller currency. |
| Event/end | PROVEN FACT | Event wire is sessionID/event and exact echo; end wire is sessionID and returned balance. betID is a local active-round guard only. |
| Zero payout | PROVEN FACT | Official Authenticate/End docs establish RGS auto-completion; returned inactive rounds permit next play without end-round. No slot timing/economic policy added. |
| Replay | PROVEN FACT | Unauthenticated GET with four independently encoded identities; codec state plus finite nonnegative multipliers. Optional launch amount/currency are display metadata only. |
| Jurisdiction wire | PROVEN FACT | config.jurisdiction only. Official TS client.ts reads that wire and constructs root jurisdictionFlags itself. Alternate root-wire parser removed. All 11 flags plus duration required; root/unowned fields are discarded. |
| Duration unit | UNRESOLVED | Official docs/types/schema expose number and zero examples, without establishing milliseconds or seconds. StakeMinimumRoundDuration is an opaque nonnegative safe-integer provider value; no conversion/timing interpretation. Provider unit confirmation remains required before consumer scheduling. |
| Provider errors | PROVEN FACT + PRODUCTION CONTRACT DECISION | Eight known codes; only the six documented client rejection codes on HTTP 4xx prove nonacceptance. ERR_GEN/ERR_MAINTENANCE, unknown/5xx/malformed payloads remain uncertain. Unknown codes/messages are discarded. |
| Single active round | INFERENCE | Session-scoped event/end plus single authenticate round support serialized single-round client admission; no universal future provider-flow claim. |
| Play reconciliation | INFERENCE + PRODUCTION CONTRACT DECISION | New betID plus exact pending amount/mode/authenticated currency permits adoption. Previous ID, null round or completed round with absent amount cannot clear uncertainty. |
| Null after dispatch | UNRESOLVED | No proof of nonacceptance; retain fence and require provider/operator truth. |
| Event/end reconciliation | PRODUCTION CONTRACT DECISION | Same round ID plus exact checkpoint or explicit inactive status. No resend or null-round inference. |
| Journal/lease | PRODUCTION CONTRACT DECISION | Version-1 exact mutation record, write before fetch, reject unknown/missing versions without deleting; no credentials. Web Locks are browser policy, distinct from protocol. |

## Request and failure models

Internal StakeEndpointRequest is a discriminated union whose operation fixes its exact body/identity. Requests owns network lifetime and cannot be called with arbitrary endpoint/body pairs. Endpoint response parsers are parseAuthenticateResponse, parsePlayResponse, parseEventResponse, parseEndRoundResponse, parseReplayResponse; parseProviderError classifies error envelopes before endpoint normalization.

StakeSession has id/balance/config/jurisdiction/round. StakeRound is active/completed; StakePlayedRound additionally makes completed play amount required. All provider objects/arrays are copied where needed and frozen. Current client session is an immutable snapshot; undefined means unauthenticated or destroyed.

StakeSdkFailure pairs category with valid codes. Protocol failures carry known/unrecognized/malformed provider classification or null (no provider envelope). Business rejection carries a known client-rejection code. PAID_DISPATCH_UNCERTAIN requires a dispatched phase, immutable exact pending mutation and typed reason. RECONCILIATION_REQUIRED requires pending facts and NOT_DISPATCHED. Human messages/raw provider messages/transport causes are never program authority. Safe category/code/dispatch getters derive from failure; kind-specific optional fields were removed.

Pending union: PLAY(amount/mode/currency/previous bet ID or null), EVENT(bet ID/event), END_ROUND(bet ID); NONE is private absence state. Journal persists version:1 plus exactly those facts. previous:null means no preceding admitted round. Storage getItem null means no journal. Browser NONE and absent policy both mean no lock; WEB_LOCKS opts in. Replay cannot accept live policy/diagnostics options.

Public paid status remains READY → DISPATCHING → CONFIRMED or AMBIGUOUS → RECONCILING → CONFIRMED/AMBIGUOUS; DESTROYED is terminal. Internal lifecycle/operation/lease/journal/interruption constants are not exported through the package root. Dispatch phase is public NOT_DISPATCHED/MAY_HAVE_DISPATCHED/RESPONSE_RECEIVED. Diagnostics are started/finished/failed with an exact operation and required failure category; no metadata bag.

## Removed architecture record

STAKE-SDK-1 retained exclusions: DistributionAdapter, renderer/engine imports, engine Money conversion, creditedMoney, mapped books/steps, slot cursor, synthetic IDs, recovery wager fallback, USD default, default-index dual parsing, currency retry, universal provider hierarchy, heartbeat/storage lease and nested legacy error parsing.

STAKE-SDK-1T removed: permissive currency brand/regex; raw string session/mode/event/replay identities; naked string|number StakeRoundId; optional round and jurisdiction field soup; config.gameID publication; alternate root jurisdictionFlags wire path; StakeJurisdictionFlags/StakePlayOptions/StakeDispatchState/StakeBrowserSessionLease/StakeDiagnostic public types; positional optional providerCode/reason error construction; unversioned journal parsing; arbitrary Requests operation/path/body pairing. No forwarding aliases or compatibility parser remain.

## Capability envelope and remaining migration

Supported: exact live/replay launch, typed identities, authentication, active/completed recovery, paid play, checkpoint/finalization, replay, strict immutable provider/title data, typed failures, timeout/abort/destroy, uncertain reconciliation, optional browser lease/journal, ESM/DTS and installed consumer. Public title interfaces need no index signatures. State lifecycle and publication laws remain in existing owners.

Excluded: generic provider API, wallet polling, provider metadata passthrough, title betModes interpretation, operator-wide device/origin lock, financial ledger/idempotency invention, game presentation/economic mapping, SL-Engine binding, unsupported codec values and consumer timing interpretation of unconfirmed duration units.

Remaining migration: NONE in this batch. Remaining evidence questions: confirm duration unit, expanded docs vocabulary admission and archived/live play currency. These are explicit evidence limits; no fallback or invented interpretation fills them. Independent hostile audit of the exact committed candidate is the next batch; this implementation pass does not perform that audit.

## Qualification of the remediation candidate (2026-10-11)

Qualification is run on the modified working tree, not inherited from the audited base. Permanent regressions cover external SDK-error spoofing through fetch/body/reflection, journal survival across recreation, rejected-play status restoration, cleanup failure fences, array subclasses, codec mutation of provider facts, recursive readonly types, and native browser crypto/storage failures.

| Command | Result |
|---|---|
| npm run build | PASS (ESM/DTS) |
| npm run typecheck | PASS (source, examples and readonly negative proofs) |
| npm run lint | PASS |
| npm run doctor | PASS (static checks) |
| npm test | PASS (105 behavior tests) |
| npm run test:integration | PASS (1 real local HTTP test) |
| npm run test:browser | PASS (5 Chromium scenarios) |
| npm run test:consumer | PASS (installed tarball, readonly DTS/ESM and private-import denial) |
| npm run pack:verify | PASS (second installed tarball consumer) |
| git diff --check | PASS |
| Independent hostile re-audit | NOT RUN |
| Real Stake transaction/commercial certification | NOT RUN |

Source integrity: no explicit any, Record bags, Partial domain types, double casts, production suppression comments or non-null assertions. External/parser/codec ingress remains unknown until validation; no normal retained-domain field uses unknown. Single brand assertions follow runtime checks. The readonly-state assertion follows complete validation, cloning and recursive freezing.

No freeze, commit, real-provider transaction, commercial certification or SL-Engine modification is part of this remediation.
