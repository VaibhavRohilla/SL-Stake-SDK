import { describe, it, expect, vi } from 'vitest';
import { stakeBetMode, stakeEventId, stakeBetId, parseStakeLaunch, stakeAmountMicros, StakeSdkError } from '../src/index.js';
import { live, replay, queue, response, auth, config, jurisdiction, balance, round, played, deferred } from './fixtures.js';
const wager = { amount: stakeAmountMicros(1_000_000), mode: stakeBetMode('BASE') };
describe('launch and exact economics', () => {
  it.each([0, 1, 1_000_000, Number.MAX_SAFE_INTEGER])('accepts safe micros %s', amount => expect(stakeAmountMicros(amount)).toBe(amount));
  it.each([-1, 0.1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1000000'])('rejects invalid micros %s', amount => expect(() => stakeAmountMicros(amount)).toThrow(StakeSdkError));
  it('copies launch and normalizes bare host without supplying session truth', () => {
    const params = new URLSearchParams('sessionID=fake&rgs_url=rgs.example&currency=BTC');
    const launch = parseStakeLaunch(params); params.set('sessionID', 'changed');
    expect(launch).toMatchObject({ kind: 'LIVE', sessionID: 'fake', rgsUrl: 'https://rgs.example' });
    expect(Object.isFrozen(launch)).toBe(true);
    expect(launch).not.toHaveProperty('currency');
  });
  it.each([
    '?sessionID=fake', '?sessionID=fake&sessionID=other&rgs_url=rgs.example',
    '?sessionID=fake&rgs_url=http://rgs.example', '?sessionID=fake&rgs_url=https://user:secret@rgs.example',
    '?sessionID=fake&rgs_url=https://rgs.example?secret=x', '?sessionID=fake&rgs_url=rgs.example&replay=wat',
    '?replay=true&sessionID=fake&rgs_url=rgs.example', '?sessionID=fake&rgs_url=rgs.example&mode=BASE',
    '?replay=true&rgs_url=rgs.example&game=g&version=1&mode=BASE&event=1&amount=1.5',
  ])('rejects malformed launch %s', launch => expect(() => parseStakeLaunch(launch)).toThrow(StakeSdkError));
  it('requires exact default bet membership, never index/nearest interpretation', async () => {
    for (const defaultBetLevel of [1, 999_999]) {
      const client = live(queue(response({ ...auth, config: { ...config, defaultBetLevel } })).fetch);
      await expect(client.authenticate()).rejects.toMatchObject({ category: 'VALIDATION' });
      expect(client.session).toBeUndefined(); client.destroy();
    }
  });
  it.each([undefined, '', 'usd', ' USD', 1])('rejects unauthoritative currency %s', async currency => {
    const client = live(queue(response({ ...auth, balance: { ...balance, currency } })).fetch);
    await expect(client.authenticate()).rejects.toMatchObject({ category: 'VALIDATION' });
    expect(client.session).toBeUndefined();
  });
});
describe('live protocol boundary', () => {
  it('authenticates, plays, records an event and ends using one exact wire shape', async () => {
    const network = queue(response(auth), response(played), response({ event: 'checkpoint:1' }), response({ balance }));
    const client = live(network.fetch);
    expect(client.session).toBeUndefined();
    const session = await client.authenticate(); expect(session.config.defaultBetAmount).toBe(1_000_000);
    expect(Object.isFrozen(session.config.betLevels)).toBe(true);
    const result = await client.play(wager); expect(Object.isFrozen(result.round.state)).toBe(true);
    await client.recordEvent(result.round.betID, stakeEventId('checkpoint:1'));
    await client.endRound(result.round.betID);
    expect(network.calls.map(call => [new URL(call.url).pathname, JSON.parse(String(call.init?.body))])).toEqual([
      ['/wallet/authenticate', { sessionID: 'fake-session', language: 'en' }],
      ['/wallet/play', { sessionID: 'fake-session', ...wager, currency: 'USD' }],
      ['/bet/event', { sessionID: 'fake-session', event: 'checkpoint:1' }],
      ['/wallet/end-round', { sessionID: 'fake-session' }],
    ]);
    expect(client.session?.round?.active).toBe(false);
    await expect(client.endRound(round.betID)).rejects.toMatchObject({ code: 'ROUND_MISMATCH' });
  });
  it('requires authentication and matching active round before dispatch', async () => {
    const network = queue(response(auth)); const client = live(network.fetch);
    await expect(client.play(wager)).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
    await client.authenticate();
    await expect(client.recordEvent(stakeBetId('wrong'), stakeEventId('event'))).rejects.toMatchObject({ code: 'ROUND_MISMATCH' });
    await expect(client.play({ ...wager, amount: stakeAmountMicros(0) })).rejects.toMatchObject({ category: 'VALIDATION' });
    expect(network.calls).toHaveLength(1);
  });
  it('recovers authoritative active round using authenticate, without synthetic economics', async () => {
    const client = live(queue(response({ ...auth, round })).fetch);
    expect(await client.getActiveRound()).toMatchObject({ ...round, currency: 'USD' });
    await expect(client.play(wager)).rejects.toMatchObject({ code: 'ACTIVE_ROUND' });
  });
  it.each(['betID', 'amount', 'mode', 'state', 'active'])('fails closed on missing recovery %s', async key => {
    const malformed = { ...round }; Reflect.deleteProperty(malformed, key);
    const client = live(queue(response({ ...auth, round: malformed })).fetch);
    await expect(client.getActiveRound()).rejects.toMatchObject({ category: 'VALIDATION' });
    expect(client.session).toBeUndefined();
  });
  it('currency mismatch and missing round identity fence dispatched play', async () => {
    for (const result of [{ ...played, balance: { ...balance, currency: 'EUR' } }, { ...played, round: { ...round, betID: undefined } }]) {
      const client = live(queue(response(auth), response(result)).fetch);
      await client.authenticate();
      await expect(client.play(wager)).rejects.toMatchObject({ category: 'AMBIGUOUS_PAID_DISPATCH' });
      expect(client.session?.round).toBeNull();
    }
  });
  it('validates codec state and does not publish partially parsed session', async () => {
    const client = live(queue(response({ ...auth, round: { ...round, state: { other: 1 } } })).fetch);
    await expect(client.authenticate()).rejects.toMatchObject({ code: 'CODEC_FAILURE' });
    expect(client.session).toBeUndefined();
  });
  it('serializes operations instead of racing session-scoped writes', async () => {
    const held = deferred<Response>(); const client = live(async () => held.promise);
    const authPromise = client.authenticate();
    await expect(client.getActiveRound()).rejects.toMatchObject({ code: 'BUSY' });
    held.resolve(response(auth)); await authPromise;
  });
});
describe('paid ambiguity and reconciliation', () => {
  it('pre-aborted request never dispatches and is not ambiguous', async () => {
    const network = queue(response(auth)); const client = live(network.fetch); await client.authenticate();
    await expect(client.play(wager, { signal: AbortSignal.abort() })).rejects.toMatchObject({ category: 'ABORTED', dispatch: 'NOT_DISPATCHED' });
    expect(client.paidDispatchStatus).toBe('READY'); expect(network.calls).toHaveLength(1);
  });
  it('transport uncertainty blocks all mutations; matching new provider round resolves it', async () => {
    let count = 0;
    const client = live(async () => { count++; if (count === 1) return response(auth); if (count === 2) throw new TypeError('fake network'); return response({ ...auth, round }); });
    await client.authenticate();
    await expect(client.play(wager)).rejects.toMatchObject({ category: 'AMBIGUOUS_PAID_DISPATCH', failure: { reason: { category: 'TRANSPORT' } } });
    await expect(client.play(wager)).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
    await expect(client.endRound(round.betID)).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
    expect(count).toBe(2); expect(client.paidDispatchStatus).toBe('AMBIGUOUS');
    await client.getActiveRound(); expect(client.paidDispatchStatus).toBe('CONFIRMED'); expect(count).toBe(3);
  });
  it('null, old identity, different amount or mode cannot authorize another wager', async () => {
    for (const recovered of [null, { ...round, amount: 100_000 }, { ...round, mode: 'BUY' }, { ...round, betID: 'prior' }]) {
      const network = queue(response({ ...auth, round: { ...round, betID: 'prior', active: false } }), response({}, 500), response({ ...auth, round: recovered }));
      const client = live(network.fetch); await client.authenticate();
      await expect(client.play(wager)).rejects.toMatchObject({ category: 'AMBIGUOUS_PAID_DISPATCH' });
      await client.authenticate(); await expect(client.play(wager)).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
      expect(network.calls).toHaveLength(3);
    }
  });
  it('validated 4xx business rejection proves nonacceptance; 5xx with same code does not', async () => {
    const network = queue(response(auth), response({ error: 'ERR_IPB' }, 400), response(played));
    const client = live(network.fetch); await client.authenticate();
    await expect(client.play(wager)).rejects.toMatchObject({ category: 'BUSINESS_REJECTION', failure: { providerCode: 'ERR_IPB' } });
    await client.play(wager); expect(network.calls).toHaveLength(3);
    const uncertain = live(queue(response(auth), response({ error: 'ERR_IPB' }, 500)).fetch); await uncertain.authenticate();
    await expect(uncertain.play(wager)).rejects.toMatchObject({ category: 'AMBIGUOUS_PAID_DISPATCH' });
  });
  it.each([new Response('bad JSON'), response({ error: { code: 'ERR_VAL' } }, 400), response({}, 401), response({ error: 'ERR_GEN' }, 500)])('malformed/uncertain response is never a definite rejection', async result => {
    const client = live(queue(response(auth), result).fetch); await client.authenticate();
    await expect(client.play(wager)).rejects.toMatchObject({ category: 'AMBIGUOUS_PAID_DISPATCH' });
  });
  it('times out across headers and body, even when fetch ignores AbortSignal', async () => {
    vi.useFakeTimers();
    try {
      const held = deferred<Response>(); let count = 0;
      const client = live(async () => ++count === 1 ? response(auth) : held.promise, { timeoutMs: 20 });
      await client.authenticate();
      const promise = client.play(wager); const assertion = expect(promise).rejects.toMatchObject({ category: 'AMBIGUOUS_PAID_DISPATCH', failure: { reason: { category: 'TIMEOUT' } } });
      await vi.advanceTimersByTimeAsync(20); await assertion; held.resolve(response(played));
      expect(client.session?.round).toBeNull(); client.destroy();
      const stream = new ReadableStream<Uint8Array>({ start() { /* held body */ } });
      const stalled = live(async () => new Response(stream), { timeoutMs: 20 });
      const pending = stalled.authenticate(); const checked = expect(pending).rejects.toMatchObject({ category: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(20); await checked; stalled.destroy();
    } finally { vi.useRealTimers(); }
  });
  it('event/end uncertainty requires reconciliation and never resends silently', async () => {
    for (const operation of ['EVENT', 'END'] as const) {
      const confirmed = operation === 'EVENT' ? { ...round, event: 'checkpoint' } : { ...round, active: false };
      const network = queue(response({ ...auth, round }), response({ error: 'ERR_GEN' }, 500), response({ ...auth, round: confirmed }));
      const client = live(network.fetch); await client.authenticate();
      const invoke = () => operation === 'EVENT' ? client.recordEvent(round.betID, stakeEventId('checkpoint')) : client.endRound(round.betID);
      await expect(invoke()).rejects.toMatchObject({ category: 'PROTOCOL' });
      await expect(invoke()).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
      expect(network.calls).toHaveLength(2);
      await client.authenticate(); expect(client.paidDispatchStatus).toBe('CONFIRMED');
    }
  });
});
describe('destroy, abort, diagnostics and isolation', () => {
  it.each(['AUTH', 'PLAY', 'ACTIVE', 'EVENT', 'END'] as const)('destroy fences held %s and late response', async operation => {
    const held = deferred<Response>(); let count = 0;
    const client = live(async () => { count++; return operation !== 'AUTH' && count === 1 ? response({ ...auth, round: operation === 'PLAY' ? null : round }) : held.promise; });
    if (operation !== 'AUTH') await client.authenticate();
    const pending = operation === 'AUTH' ? client.authenticate() : operation === 'PLAY' ? client.play(wager)
      : operation === 'ACTIVE' ? client.getActiveRound() : operation === 'EVENT' ? client.recordEvent(round.betID, stakeEventId('checkpoint')) : client.endRound(round.betID);
    await Promise.resolve(); client.destroy();
    await expect(pending).rejects.toMatchObject(operation === 'PLAY'
      ? { category: 'AMBIGUOUS_PAID_DISPATCH', failure: { reason: { category: 'LIFECYCLE' } } } : { category: 'LIFECYCLE' });
    held.resolve(response(operation === 'PLAY' ? played : { ...auth, round })); await Promise.resolve();
    expect(client.session).toBeUndefined(); expect(client.paidDispatchStatus).toBe('DESTROYED');
    await expect(client.authenticate()).rejects.toMatchObject({ code: 'DESTROYED' });
  });
  it('destroy during ambiguity reconciliation cannot clear pending or publish state', async () => {
    const held = deferred<Response>(); let count = 0;
    const client = live(async () => { count++; if (count === 1) return response(auth); if (count === 2) throw new Error('fake'); return held.promise; });
    await client.authenticate(); await expect(client.play(wager)).rejects.toBeInstanceOf(StakeSdkError);
    const pending = client.getActiveRound(); await Promise.resolve(); client.destroy();
    await expect(pending).rejects.toMatchObject({ category: 'LIFECYCLE' }); held.resolve(response({ ...auth, round }));
    expect(client.session).toBeUndefined(); expect(client.paidDispatchStatus).toBe('DESTROYED');
  });
  it('user abort after possible dispatch remains an explicit ambiguity reason', async () => {
    const held = deferred<Response>(); let count = 0; const controller = new AbortController();
    const client = live(async () => ++count === 1 ? response(auth) : held.promise); await client.authenticate();
    const pending = client.play(wager, { signal: controller.signal }); controller.abort();
    await expect(pending).rejects.toMatchObject({ category: 'AMBIGUOUS_PAID_DISPATCH', failure: { reason: { category: 'ABORTED' } } });
    held.resolve(response(played)); client.destroy();
  });
  it('clients retain independent currency, rounds, paid state and destruction', async () => {
    const a = live(queue(response(auth), response({}, 500)).fetch);
    const b = live(queue(response({ ...auth, balance: { ...balance, currency: 'EUR' } }), response({ ...played, balance: { ...balance, currency: 'EUR' } })).fetch);
    await a.authenticate(); await b.authenticate(); await expect(a.play(wager)).rejects.toBeInstanceOf(StakeSdkError);
    a.destroy(); const result = await b.play(wager); expect(result.balance.currency).toBe('EUR'); expect(b.session?.round?.betID).toBe(round.betID);
  });
  it('diagnostics contain no credentials/payloads and cannot invalidate an accepted operation', async () => {
    const events: import('../src/index.js').StakeDiagnosticEvent[] = []; const client = live(queue(response(auth)).fetch, { diagnostics(event) { events.push(event); throw new Error('observer'); } });
    await client.authenticate(); expect(JSON.stringify(events)).not.toContain('fake-session'); expect(JSON.stringify(events)).not.toContain('USD');
    client.destroy();
  });
  it('lease is opt-in and explicit browser policy fails closed in Node', async () => {
    const client = live(queue(response(auth)).fetch, { sessionLease: { kind: 'WEB_LOCKS' } });
    await expect(client.authenticate()).rejects.toMatchObject({ code: 'LEASE_UNAVAILABLE' }); client.destroy();
  });
});
describe('replay-safe protocol', () => {
  it('uses only unauthenticated replay GET and validates typed game state', async () => {
    const network = queue(response({ state: { value: 3 }, payoutMultiplier: 2, costMultiplier: 1 }));
    const client = replay(network.fetch); expect(await client.acquire()).toEqual({ state: { value: 3 }, payoutMultiplier: 2, costMultiplier: 1 });
    expect(network.calls[0]?.url).toBe('https://fake-rgs.example/bet/replay/fake-game/1/BASE/55');
    expect(network.calls[0]?.init?.method).toBe('GET'); expect(network.calls[0]?.init?.body).toBeUndefined();
    expect(client).not.toHaveProperty('play'); expect(client).not.toHaveProperty('recordEvent'); expect(client).not.toHaveProperty('endRound'); client.destroy();
  });
  it('rejects malformed replay, preserves abort and destroy taxonomy', async () => {
    const client = replay(queue(response({ state: { value: 3 }, payoutMultiplier: -1, costMultiplier: 1 })).fetch);
    await expect(client.acquire()).rejects.toMatchObject({ category: 'VALIDATION' });
    await expect(client.acquire({ signal: AbortSignal.abort() })).rejects.toMatchObject({ category: 'ABORTED' });
    client.destroy(); await expect(client.acquire()).rejects.toMatchObject({ category: 'LIFECYCLE' });
  });
});
describe('pending mutation persistence', () => {
  function storage() {
    const items = new Map<string, string>();
    return { items, getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
  }
  it('records before paid dispatch; destroy and recreation cannot erase uncertainty', async () => {
    const store = storage();
    const first = live(async url => {
      if (String(url).endsWith('/authenticate')) return response(auth);
      expect(store.items.size).toBe(1); throw new Error('fake lost response');
    }, { pendingDispatchStorage: store });
    await first.authenticate(); await expect(first.play(wager)).rejects.toMatchObject({ category: 'AMBIGUOUS_PAID_DISPATCH' });
    first.destroy(); expect(store.items.size).toBe(1);
    expect(JSON.stringify([...store.items])).not.toContain('fake-session');
    const network = queue(response(auth), response({ ...auth, round }));
    const second = live(network.fetch, { pendingDispatchStorage: store });
    await second.authenticate(); await expect(second.play(wager)).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
    expect(network.calls).toHaveLength(1); await second.getActiveRound(); expect(store.items.size).toBe(0); second.destroy();
  });
  it('storage failure before fetch is safe and does not send a wager', async () => {
    const store = storage(); store.setItem = () => { throw new Error('denied'); };
    const network = queue(response(auth)); const client = live(network.fetch, { pendingDispatchStorage: store });
    await client.authenticate(); await expect(client.play(wager)).rejects.toMatchObject({ category: 'SESSION', code: 'PENDING_STORAGE_FAILURE', dispatch: 'NOT_DISPATCHED' });
    expect(network.calls).toHaveLength(1); client.destroy();
  });
  it('storage failure after confirmation retains the fence and does not publish the round', async () => {
    const store = storage(); store.removeItem = () => { throw new Error('denied'); };
    const network = queue(response(auth), response(played)); const client = live(network.fetch, { pendingDispatchStorage: store });
    await client.authenticate(); await expect(client.play(wager)).rejects.toMatchObject({ category: 'AMBIGUOUS_PAID_DISPATCH', dispatch: 'RESPONSE_RECEIVED' });
    expect(client.session?.round).toBeNull(); expect(store.items.size).toBe(1);
    await expect(client.play(wager)).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' }); client.destroy();
  });
  it('corrupt stored pending truth fails closed without network dispatch', async () => {
    const store = storage(); const first = live(queue(response(auth), response({}, 500)).fetch, { pendingDispatchStorage: store });
    await first.authenticate(); await expect(first.play(wager)).rejects.toBeInstanceOf(StakeSdkError); first.destroy();
    for (const key of store.items.keys()) store.items.set(key, '{bad JSON');
    const network = queue(response(auth)); const second = live(network.fetch, { pendingDispatchStorage: store });
    await expect(second.authenticate()).rejects.toMatchObject({ code: 'PENDING_STORAGE_FAILURE' }); expect(network.calls).toHaveLength(0); second.destroy();
  });
});
describe('additional provider facts and lifecycle boundaries', () => {
  it('publishes canonical jurisdiction and discards unowned provider fields', async () => {
    const client = live(queue(response({ ...auth, round: { ...round, event: null, costMultiplier: 100 },
      config: { ...config, gameID: 'ignored', betModes: { arbitrary: 1 }, jurisdiction: { ...jurisdiction, disabledBuyFeature: true } },
      jurisdictionFlags: { disabledTurbo: true }, meta: { private: 1 } })).fetch);
    const session = await client.authenticate();
    expect(session.round?.event).toBeNull(); expect(session.round?.costMultiplier).toBe(100);
    expect(session.jurisdiction).toEqual({ ...jurisdiction, disabledBuyFeature: true });
    expect(session.config).not.toHaveProperty('gameID'); expect(session.config).not.toHaveProperty('betModes');
    expect(session).not.toHaveProperty('jurisdictionFlags'); expect(session).not.toHaveProperty('meta'); client.destroy();
  });
  it('root jurisdictionFlags cannot satisfy missing canonical wire jurisdiction', async () => {
    const client = live(queue(response({ ...auth, config: { ...config, jurisdiction: undefined }, jurisdictionFlags: jurisdiction })).fetch);
    await expect(client.authenticate()).rejects.toMatchObject({ category: 'VALIDATION' }); expect(client.session).toBeUndefined(); client.destroy();
  });
  it.each(['EVENT', 'END'] as const)('user abort of %s fences further mutations', async operation => {
    const held = deferred<Response>(); let count = 0;
    const client = live(async () => ++count === 1 ? response({ ...auth, round }) : held.promise);
    await client.authenticate(); const controller = new AbortController();
    const pending = operation === 'EVENT' ? client.recordEvent(round.betID, stakeEventId('checkpoint'), { signal: controller.signal })
      : client.endRound(round.betID, { signal: controller.signal }); controller.abort();
    await expect(pending).rejects.toMatchObject({ category: 'ABORTED' });
    await expect(client.endRound(round.betID)).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
    held.resolve(response({ balance })); client.destroy();
  });
  it('event mismatch is validation failure, preserves the round and blocks further mutation', async () => {
    const client = live(queue(response({ ...auth, round }), response({ event: 'other' })).fetch); await client.authenticate();
    await expect(client.recordEvent(round.betID, stakeEventId('checkpoint'))).rejects.toMatchObject({ category: 'VALIDATION' });
    expect(client.session?.round?.event).toBeNull(); await expect(client.endRound(round.betID)).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' }); client.destroy();
  });
  it('a codec cannot reenter destroyed client publication', async () => {
    const network = queue(response({ ...auth, round }));
    const launch = parseStakeLaunch('?sessionID=fake-codec&rgs_url=rgs.example'); if (launch.kind !== 'LIVE') throw new Error('fixture');
    const { createStakeLiveClient } = await import('../src/index.js');
    const client = createStakeLiveClient({ launch, fetch: network.fetch, codec: { parse() { client.destroy(); return 1; } } });
    await expect(client.authenticate()).rejects.toMatchObject({ category: 'LIFECYCLE' }); expect(client.session).toBeUndefined();
  });
});
it('reentrant destroy from injected journal cannot dispatch or create false paid ambiguity', async () => {
  const items = new Map<string, string>(); const network = queue(response(auth));
  const store = { getItem: (key: string) => items.get(key) ?? null,
    setItem(key: string, value: string) { items.set(key, value); client.destroy(); },
    removeItem(key: string) { items.delete(key); } };
  const client = live(network.fetch, { pendingDispatchStorage: store }); await client.authenticate();
  await expect(client.play(wager)).rejects.toMatchObject({ category: 'LIFECYCLE', dispatch: 'NOT_DISPATCHED' });
  expect(network.calls).toHaveLength(1); expect(items.size).toBe(0); expect(client.session).toBeUndefined();
});
