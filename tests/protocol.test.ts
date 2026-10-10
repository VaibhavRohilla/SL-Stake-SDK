import { describe, expect, it } from 'vitest';
import { STAKE_CURRENCY_CODE, STAKE_LANGUAGE, STAKE_DEVICE, STAKE_LAUNCH_MODE, STAKE_ERROR_CATEGORY, STAKE_ERROR_CODE,
  parseStakeLaunch, stakeCurrencyCode, stakeLanguage, stakeDevice, stakeSessionId, stakeBetId, stakeBetMode,
  stakeEventId, stakeGameId, stakeGameVersion, stakeReplayEventId, stakeAmountMicros, createStakeLiveClient,
  createStakeReplayClient, StakeSdkError } from '../src/index.js';
import { stakeMultiplier, stakeMinimumRoundDuration } from '../src/domain.js';
import { parseJurisdiction, parseRound } from '../src/protocol.js';
import { auth, balance, config, jurisdiction, round, codec, queue, response, live } from './fixtures.js';
describe('governed provider domains', () => {
  it('accepts exactly the supported currency, language and device vocabularies', () => {
    for (const value of Object.values(STAKE_CURRENCY_CODE)) expect(stakeCurrencyCode(value)).toBe(value);
    for (const value of Object.values(STAKE_LANGUAGE)) expect(stakeLanguage(value)).toBe(value);
    for (const value of Object.values(STAKE_DEVICE)) expect(stakeDevice(value)).toBe(value);
    for (const input of ['usd', 'BTC', 'NOT_REAL', '', 1, null]) expect(() => stakeCurrencyCode(input)).toThrow(StakeSdkError);
    for (const input of ['EN', 'en-US', 'zz', '', 1]) expect(() => stakeLanguage(input)).toThrow(StakeSdkError);
    for (const input of ['tablet', 'Mobile', '', 1]) expect(() => stakeDevice(input)).toThrow(StakeSdkError);
    expect(Object.isFrozen(STAKE_CURRENCY_CODE)).toBe(true);
  });
  it('validates identities without rewriting their representation or adding arbitrary length limits', () => {
    const parsers = [stakeSessionId, stakeBetMode, stakeEventId, stakeGameId, stakeGameVersion, stakeReplayEventId];
    for (const parse of parsers) {
      expect(parse('provider/one ?')).toBe('provider/one ?');
      expect(parse('x'.repeat(4096))).toHaveLength(4096);
      for (const input of ['', ' spaced ', '\u0000', '\u007f', null, undefined, 1]) expect(() => parse(input)).toThrow(StakeSdkError);
    }
    for (const id of [0, 1, Number.MAX_SAFE_INTEGER, '0', '001']) expect(stakeBetId(id)).toBe(id);
    for (const id of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '', ' one ']) expect(() => stakeBetId(id)).toThrow(StakeSdkError);
  });
  it('retains finite nonnegative multipliers without calculating money', () => {
    for (const value of [0, 0.25, 2.5, Number.MAX_VALUE]) expect(stakeMultiplier(value)).toBe(value);
    for (const value of [-1, NaN, Infinity, -Infinity, '2', null]) expect(() => stakeMultiplier(value)).toThrow(StakeSdkError);
    for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) expect(stakeMinimumRoundDuration(value)).toBe(value);
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1']) expect(() => stakeMinimumRoundDuration(value)).toThrow(StakeSdkError);
  });
  it('normalizes absent launch context and strictly parses supplied context', () => {
    const launch = parseStakeLaunch('?sessionID=one&rgs_url=rgs.example');
    expect(launch).toMatchObject({ lang: STAKE_LANGUAGE.EN, device: STAKE_DEVICE.DESKTOP, social: false });
    expect(parseStakeLaunch('?sessionID=one&rgs_url=rgs.example&lang=ja&device=mobile&social=true')).toMatchObject({ lang: 'ja', device: 'mobile', social: true });
    expect(parseStakeLaunch('?sessionID=one&rgs_url=rgs.example&social=false')).toHaveProperty('social', false);
    for (const suffix of ['lang=zz', 'device=tablet', 'social=1', 'social=False']) {
      expect(() => parseStakeLaunch('?sessionID=one&rgs_url=rgs.example&' + suffix)).toThrow(StakeSdkError);
    }
  });
});
describe('exact jurisdiction and config', () => {
  it('requires every exact flag and rejects coerced booleans', () => {
    expect(parseJurisdiction(jurisdiction)).toEqual(jurisdiction);
    for (const key of Object.keys(jurisdiction)) {
      const missing = { ...jurisdiction }; Reflect.deleteProperty(missing, key);
      expect(() => parseJurisdiction(missing)).toThrow(StakeSdkError);
      if (key === 'minimumRoundDuration') continue;
      for (const value of ['false', 0, 1, null]) expect(() => parseJurisdiction({ ...jurisdiction, [key]: value })).toThrow(StakeSdkError);
      expect(parseJurisdiction({ ...jurisdiction, [key]: true })).toHaveProperty(key, true);
    }
  });
  it('preserves level order and uses membership as the sole play admission predicate', async () => {
    const unsorted = { ...config, betLevels: [10_000_000, 100_000, 1_000_000], stepBet: 3 };
    const network = queue(response({ ...auth, config: unsorted }), response({ balance, round }));
    const client = live(network.fetch); const session = await client.authenticate();
    expect(session.config.betLevels).toEqual(unsorted.betLevels);
    await client.play({ amount: session.config.defaultBetAmount, mode: stakeBetMode('BASE') }); client.destroy();
    for (const patch of [{ stepBet: 0 }, { minBet: 11_000_000 }, { betLevels: [] }, { betLevels: [1_000_000, 1_000_000] },
      { betLevels: [1] }, { betLevels: [Infinity] }, { defaultBetLevel: 1 }]) {
      const rejected = live(queue(response({ ...auth, config: { ...config, ...patch } })).fetch);
      await expect(rejected.authenticate()).rejects.toMatchObject({ code: STAKE_ERROR_CODE.INVALID_RESPONSE }); rejected.destroy();
    }
  });
});
describe('round and response normalization', () => {
  it('requires active recovery amount and discriminates completed rounds with missing economics', () => {
    const parsed = parseRound(round, STAKE_CURRENCY_CODE.USD, codec);
    expect(parsed).toMatchObject({ active: true, event: null, costMultiplier: null, currency: 'USD' });
    for (const amount of [undefined, null, NaN, Infinity, -1]) expect(() => parseRound({ ...round, amount }, STAKE_CURRENCY_CODE.USD, codec)).toThrow(StakeSdkError);
    const completed = parseRound({ ...round, active: false, amount: undefined, payout: undefined, payoutMultiplier: undefined }, STAKE_CURRENCY_CODE.USD, codec);
    expect(completed).toMatchObject({ active: false, amount: null, payout: null, payoutMultiplier: null, event: null });
    expect(() => parseRound({ ...round, active: 'false' }, STAKE_CURRENCY_CODE.USD, codec)).toThrow(StakeSdkError);
    expect(() => parseRound({ ...round, event: '' }, STAKE_CURRENCY_CODE.USD, codec)).toThrow(StakeSdkError);
  });
  it('represents auto-completed zero-payout play without requiring an end-round dispatch', async () => {
    const network = queue(response(auth), response({ balance, round: { ...round, active: false, payout: 0, payoutMultiplier: 0 } }),
      response({ balance, round: { ...round, betID: 2, active: false, payout: 0 } }));
    const client = live(network.fetch); await client.authenticate();
    const wager = { amount: stakeAmountMicros(1_000_000), mode: stakeBetMode('BASE') };
    const first = await client.play(wager); expect(first.round.active).toBe(false);
    await expect(client.endRound(first.round.betID)).rejects.toMatchObject({ code: STAKE_ERROR_CODE.ROUND_MISMATCH });
    await client.play(wager); expect(network.calls).toHaveLength(3); client.destroy();
  });
  it('never publishes raw envelope debris and freezes all published provider facts', async () => {
    const sourceState = { value: 7 };
    const client = live(queue(response({ ...auth, config: { ...config, gameID: 'extra', betModes: { ignored: 1 } },
      meta: { ignored: 1 }, round: { ...round, state: sourceState, arbitrary: 'ignored' } })).fetch);
    const session = await client.authenticate();
    expect(Object.keys(session)).toEqual(['id', 'balance', 'config', 'jurisdiction', 'round']);
    for (const value of [session, session.balance, session.config, session.config.betLevels, session.jurisdiction, session.round, session.round?.state]) expect(Object.isFrozen(value)).toBe(true);
    expect(session.round).not.toHaveProperty('arbitrary'); sourceState.value = 8; expect(session.round?.state.value).toBe(7); client.destroy();
  });
  it('keeps a completed round with absent amount fenced during paid reconciliation', async () => {
    const network = queue(response(auth), response({}, 500), response({ ...auth, round: { ...round, active: false, amount: undefined } }));
    const client = live(network.fetch); await client.authenticate();
    await expect(client.play({ amount: stakeAmountMicros(1_000_000), mode: stakeBetMode('BASE') })).rejects.toMatchObject({ category: STAKE_ERROR_CATEGORY.AMBIGUOUS_PAID_DISPATCH });
    await client.authenticate(); await expect(client.play({ amount: stakeAmountMicros(1_000_000), mode: stakeBetMode('BASE') })).rejects.toMatchObject({ code: STAKE_ERROR_CODE.RECONCILIATION_REQUIRED }); client.destroy();
  });
});
describe('codec supported plain data law', () => {
  const launch = parseStakeLaunch('?sessionID=one&rgs_url=rgs.example');
  if (launch.kind !== STAKE_LAUNCH_MODE.LIVE) throw new Error('fixture');
  async function acquire<T>(state: T) {
    if (launch.kind !== STAKE_LAUNCH_MODE.LIVE) throw new Error('fixture');
    const client = createStakeLiveClient({ launch, codec: { parse: () => state }, fetch: queue(response({ ...auth, round })).fetch });
    try { return await client.authenticate(); } finally { client.destroy(); }
  }
  it('copies and recursively freezes finite primitive/plain object/array data', async () => {
    const state = { nested: [null, true, 1.5, 'one', { value: 2 }] };
    const session = await acquire(state);
    expect(session.round?.state).toEqual(state); expect(session.round?.state).not.toBe(state);
    expect(Object.isFrozen(session.round?.state.nested)).toBe(true); expect(Object.isFrozen(session.round?.state.nested[4])).toBe(true);
    expect(Object.isFrozen(state)).toBe(false);
    const shared = { value: 1 }; await acquire({ a: shared, b: shared });
  });
  it('rejects unsupported values before structuredClone can erase their meaning', async () => {
    class State { value = 1; }
    interface CyclicState { self?: CyclicState }
    const cycle: CyclicState = {}; cycle.self = cycle;
    const sparse = new Array(2);
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('must not run'); } });
    for (const state of [undefined, NaN, Infinity, 1n, Symbol('one'), () => 1, new Date(), new Map(), new Set(),
      new ArrayBuffer(4), new Uint8Array(4), new State(), cycle, sparse, accessor, { hidden: undefined }, { [Symbol('key')]: 1 }]) {
      await expect(acquire(state)).rejects.toMatchObject({ code: STAKE_ERROR_CODE.CODEC_FAILURE });
    }
  });
});
describe('wire and ambiguity contracts', () => {
  it('sends exact language and single currency wire without caller currency authority', async () => {
    const launch = parseStakeLaunch('?sessionID=one&rgs_url=rgs.example&lang=ja'); if (launch.kind !== STAKE_LAUNCH_MODE.LIVE) throw new Error('fixture');
    const network = queue(response(auth), response({ balance, round }));
    const client = createStakeLiveClient({ launch, codec, fetch: network.fetch }); await client.authenticate();
    const command = { amount: stakeAmountMicros(1_000_000), mode: stakeBetMode('BASE'), currency: 'EUR' };
    await client.play(command);
    expect(JSON.parse(String(network.calls[0]?.init?.body))).toEqual({ sessionID: 'one', language: 'ja' });
    expect(JSON.parse(String(network.calls[1]?.init?.body))).toEqual({ sessionID: 'one', amount: 1_000_000, mode: 'BASE', currency: 'USD' }); client.destroy();
  });
  it('encodes each replay path segment independently without live credentials', async () => {
    const values = ['game/a', 'v?b', 'mode#c', 'event/d'];
    const params = new URLSearchParams({ replay: 'true', rgs_url: 'rgs.example', game: values[0] ?? '', version: values[1] ?? '', mode: values[2] ?? '', event: values[3] ?? '' });
    const launch = parseStakeLaunch(params); if (launch.kind !== STAKE_LAUNCH_MODE.REPLAY) throw new Error('fixture');
    const network = queue(response({ state: { value: 1 }, payoutMultiplier: 0, costMultiplier: 1 }));
    const client = createStakeReplayClient({ launch, codec, fetch: network.fetch }); await client.acquire();
    expect(network.calls[0]?.url).toBe('https://rgs.example/bet/replay/' + values.map(encodeURIComponent).join('/'));
    expect(network.calls[0]?.init?.body).toBeUndefined(); expect(network.calls[0]?.init?.headers).toBeUndefined(); client.destroy();
    for (const game of ['.', '..']) {
      expect(() => createStakeReplayClient({ launch: { ...launch, game: stakeGameId(game) }, codec })).toThrow(StakeSdkError);
    }
  });
  it('carries immutable exact pending and underlying failure in paid ambiguity', async () => {
    const client = live(queue(response(auth), response({ error: 'UNRECOGNIZED_CODE', message: 'unsafe secret' }, 400)).fetch); await client.authenticate();
    try {
      await client.play({ amount: stakeAmountMicros(1_000_000), mode: stakeBetMode('BASE') }); throw new Error('unexpected');
    } catch (error) {
      if (!(error instanceof StakeSdkError) || error.failure.category !== STAKE_ERROR_CATEGORY.AMBIGUOUS_PAID_DISPATCH || error.failure.code !== STAKE_ERROR_CODE.PAID_DISPATCH_UNCERTAIN) throw error;
      expect(error.failure.pending).toEqual({ kind: 'PLAY', amount: 1_000_000, mode: 'BASE', currency: 'USD', previous: null });
      expect(error.failure.reason).toMatchObject({ category: 'PROTOCOL', provider: { kind: 'UNRECOGNIZED' } });
      expect(Object.isFrozen(error.failure)).toBe(true); expect(Object.isFrozen(error.failure.pending)).toBe(true); expect(Object.isFrozen(error.failure.reason)).toBe(true);
      expect(JSON.stringify(error.failure)).not.toContain('unsafe secret'); expect(JSON.stringify(error.failure)).not.toContain('UNRECOGNIZED_CODE');
    } finally { client.destroy(); }
  });
  it.each(['ERR_GEN', 'ERR_MAINTENANCE'])('never treats server code %s as business nonacceptance even on 4xx', async error => {
    const client = live(queue(response(auth), response({ error }, 400)).fetch); await client.authenticate();
    await expect(client.play({ amount: stakeAmountMicros(1_000_000), mode: stakeBetMode('BASE') })).rejects.toMatchObject({ category: STAKE_ERROR_CATEGORY.AMBIGUOUS_PAID_DISPATCH }); client.destroy();
  });
});
describe('versioned pending journal', () => {
  it('persists only exact V1 mutation facts and rejects absent/unknown versions before dispatch', async () => {
    for (const version of [undefined, 0, 2, '1']) {
      const items = new Map<string, string>();
      const store = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
      const client = live(queue(response(auth), response({}, 500)).fetch, { pendingDispatchStorage: store }); await client.authenticate();
      await expect(client.play({ amount: stakeAmountMicros(1_000_000), mode: stakeBetMode('BASE') })).rejects.toBeInstanceOf(StakeSdkError); client.destroy();
      for (const [key, stored] of items) {
        const record: unknown = JSON.parse(stored);
        if (record === null || typeof record !== 'object') throw new Error('fixture journal');
        expect(record).toEqual({ version: 1, kind: 'PLAY', amount: 1_000_000, mode: 'BASE', currency: 'USD', previous: null });
        items.set(key, JSON.stringify({ ...record, version }));
      }
      const network = queue(response(auth)); const next = live(network.fetch, { pendingDispatchStorage: store });
      await expect(next.authenticate()).rejects.toMatchObject({ code: STAKE_ERROR_CODE.PENDING_STORAGE_FAILURE }); expect(network.calls).toHaveLength(0); expect(items.size).toBe(1); next.destroy();
    }
  });
});

it.each(['EVENT', 'END_ROUND'] as const)('recreates exact V1 %s journal and clears it only on matching truth', async kind => {
  const items = new Map<string, string>();
  const store = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
  const first = live(queue(response({ ...auth, round }), response({}, 500)).fetch, { pendingDispatchStorage: store }); await first.authenticate();
  const event = stakeEventId('checkpoint');
  await expect(kind === 'EVENT' ? first.recordEvent(round.betID, event) : first.endRound(round.betID)).rejects.toBeInstanceOf(StakeSdkError);
  for (const stored of items.values()) expect(JSON.parse(stored)).toEqual(kind === 'EVENT'
    ? { version: 1, kind, betID: round.betID, event } : { version: 1, kind, betID: round.betID });
  first.destroy();
  const confirmed = kind === 'EVENT' ? { ...round, event } : { ...round, active: false };
  const network = queue(response({ ...auth, round }), response({ ...auth, round: confirmed }));
  const next = live(network.fetch, { pendingDispatchStorage: store }); await next.authenticate();
  await expect(next.endRound(round.betID)).rejects.toMatchObject({ code: STAKE_ERROR_CODE.RECONCILIATION_REQUIRED });
  expect(items.size).toBe(1); await next.authenticate(); expect(items.size).toBe(0); next.destroy();
});
