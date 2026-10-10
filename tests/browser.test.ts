import { test, expect } from '@playwright/test';
import type { StakeLiveClient } from '../src/index.js';
import type { State } from './fixtures.js';
declare global { interface Window { fixtureClient: StakeLiveClient<State> } }
test('native browser HTTP live flow and isolated replay', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const sdk: typeof import('../src/index.js') = await import(`${location.origin}/sdk/index.js`);
    const codec = { parse(input: unknown) {
      if (input === null || typeof input !== 'object' || !('value' in input) || typeof input.value !== 'number') throw new Error('invalid state');
      return { value: input.value };
    } };
    const launch = sdk.parseStakeLaunch(`?sessionID=fake-browser&rgs_url=${location.origin}`, { allowHttp: true });
    if (launch.kind !== 'LIVE') throw new Error('launch');
    const a = sdk.createStakeLiveClient({ launch, codec });
    const b = sdk.createStakeLiveClient({ launch: { ...launch, sessionID: sdk.stakeSessionId('fake-independent') }, codec });
    const session = await a.authenticate(); await b.authenticate();
    const played = await a.play({ amount: session.config.defaultBetAmount, mode: sdk.stakeBetMode('BASE') });
    await a.recordEvent(played.round.betID, sdk.stakeEventId('checkpoint')); await a.endRound(played.round.betID); a.destroy();
    const independent = await b.play({ amount: session.config.defaultBetAmount, mode: sdk.stakeBetMode('BASE') }); b.destroy();
    const replayLaunch = sdk.parseStakeLaunch(`?replay=true&rgs_url=${location.origin}&game=fake&version=1&mode=BASE&event=1`, { allowHttp: true });
    if (replayLaunch.kind !== 'REPLAY') throw new Error('launch');
    const replay = sdk.createStakeReplayClient({ launch: replayLaunch, codec }); const replayed = await replay.acquire(); replay.destroy();
    return { played: played.round.state.value, independent: independent.round.state.value, replay: replayed.state.value };
  });
  expect(result).toEqual({ played: 7, independent: 7, replay: 7 });
});
test('browser AbortSignal, timeout and late response fencing across operations', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const sdk: typeof import('../src/index.js') = await import(`${location.origin}/sdk/index.js`);
    const launch = sdk.parseStakeLaunch(`?sessionID=fake-held&rgs_url=${location.origin}`, { allowHttp: true });
    if (launch.kind !== 'LIVE') throw new Error('launch');
    const codec = { parse(input: unknown) { if (typeof input !== 'number') throw new Error('state'); return input; } };
    const balance = { amount: 10_000_000, currency: 'USD' };
    const config = { minBet: 100_000, maxBet: 10_000_000, stepBet: 100_000, defaultBetLevel: 1_000_000, betLevels: [1_000_000], jurisdiction: { socialCasino: false, disabledFullscreen: false, disabledTurbo: false, disabledSuperTurbo: false, disabledAutoplay: false, disabledSlamstop: false, disabledSpacebar: false, disabledBuyFeature: false, displayNetPosition: false, displayRTP: false, displaySessionTimer: false, minimumRoundDuration: 0 } };
    const round = { betID: sdk.stakeBetId('fake-held-round'), amount: 1_000_000, active: true, mode: sdk.stakeBetMode('BASE'), state: 7 };
    const categories: string[] = [];
    for (const operation of ['AUTH', 'PLAY', 'ACTIVE', 'EVENT', 'END']) {
      let release: (response: Response) => void = () => { throw new Error('pending'); };
      const held = new Promise<Response>(resolve => { release = resolve; }); let count = 0;
      const fetchImpl: typeof fetch = async () => ++count === 1 && operation !== 'AUTH'
        ? Response.json({ balance, config, round: operation === 'PLAY' ? null : round }) : held;
      const client = sdk.createStakeLiveClient({ launch, codec, fetch: fetchImpl });
      if (operation !== 'AUTH') await client.authenticate();
      const pending = operation === 'AUTH' ? client.authenticate() : operation === 'PLAY' ? client.play({ amount: sdk.stakeAmountMicros(1_000_000), mode: sdk.stakeBetMode('BASE') })
        : operation === 'ACTIVE' ? client.getActiveRound() : operation === 'EVENT' ? client.recordEvent(round.betID, sdk.stakeEventId('checkpoint')) : client.endRound(round.betID);
      await Promise.resolve(); client.destroy();
      try { await pending; throw new Error('unexpected success'); }
      catch (error) { if (!(error instanceof sdk.StakeSdkError)) throw error; categories.push(error.failure.category === sdk.STAKE_ERROR_CATEGORY.AMBIGUOUS_PAID_DISPATCH && error.failure.code === sdk.STAKE_ERROR_CODE.PAID_DISPATCH_UNCERTAIN ? error.failure.reason.category : error.category); }
      release(Response.json({ balance, config, round })); await Promise.resolve();
      if (client.session !== undefined) throw new Error('late publication');
    }
    const heldFetch: typeof fetch = async () => new Promise<Response>(() => { /* ignores signal intentionally */ });
    const abortClient = sdk.createStakeLiveClient({ launch, codec, fetch: heldFetch });
    const abort = new AbortController(); const pending = abortClient.authenticate({ signal: abort.signal }); abort.abort();
    try { await pending; } catch (error) { if (!(error instanceof sdk.StakeSdkError)) throw error; categories.push(error.category); } abortClient.destroy();
    const timed = sdk.createStakeLiveClient({ launch, codec, fetch: heldFetch, timeoutMs: 10 });
    try { await timed.authenticate(); } catch (error) { if (!(error instanceof sdk.StakeSdkError)) throw error; categories.push(error.category); } timed.destroy();
    return categories;
  });
  expect(results).toEqual(['LIFECYCLE', 'LIFECYCLE', 'LIFECYCLE', 'LIFECYCLE', 'LIFECYCLE', 'ABORTED', 'TIMEOUT']);
});
test('atomic cross-tab lease collision, independent session, destroy and crashed-tab release', async ({ context }) => {
  const first = await context.newPage(), second = await context.newPage(); await first.goto('/'); await second.goto('/');
  const acquire = async (page: typeof first, sessionID: string) => page.evaluate(async sessionID => {
    const sdk: typeof import('../src/index.js') = await import(`${location.origin}/sdk/index.js`);
    const launch = sdk.parseStakeLaunch(`?sessionID=${sessionID}&rgs_url=${location.origin}`, { allowHttp: true });
    if (launch.kind !== 'LIVE') throw new Error('launch');
    const codec = { parse(input: unknown) { if (input === null || typeof input !== 'object' || !('value' in input) || typeof input.value !== 'number') throw new Error('state'); return { value: input.value }; } };
    window.fixtureClient = sdk.createStakeLiveClient({ launch, codec, sessionLease: { kind: 'WEB_LOCKS' } });
    try { await window.fixtureClient.authenticate(); return 'HELD'; }
    catch (error) { window.fixtureClient.destroy(); if (!(error instanceof sdk.StakeSdkError)) throw error; return error.code; }
  }, sessionID);
  expect(await acquire(first, 'fake-leased')).toBe('HELD');
  expect(await acquire(second, 'fake-leased')).toBe('LEASE_CONFLICT');
  expect(await acquire(second, 'fake-other')).toBe('HELD');
  await second.evaluate(() => window.fixtureClient.destroy());
  await first.evaluate(() => window.fixtureClient.destroy());
  expect(await acquire(second, 'fake-leased')).toBe('HELD');
  await second.close();
  expect(await acquire(first, 'fake-leased')).toBe('HELD');
  await first.close();
});
test('browser journal survives client recreation and replay never leases', async ({ context }) => {
  const first = await context.newPage(), second = await context.newPage(); await first.goto('/'); await second.goto('/');
  await first.evaluate(async () => {
    const sdk: typeof import('../src/index.js') = await import(`${location.origin}/sdk/index.js`);
    const launch = sdk.parseStakeLaunch(`?sessionID=fake-uncertain&rgs_url=${location.origin}`, { allowHttp: true }); if (launch.kind !== 'LIVE') throw new Error('launch');
    const codec = { parse(input: unknown) { if (input === null || typeof input !== 'object' || !('value' in input) || typeof input.value !== 'number') throw new Error('state'); return { value: input.value }; } };
    const fetchImpl: typeof fetch = async (url, init) => { if (String(url).endsWith('/play')) throw new Error('fake network uncertainty'); return fetch(url, init); };
    window.fixtureClient = sdk.createStakeLiveClient({ launch, codec, fetch: fetchImpl, sessionLease: { kind: 'WEB_LOCKS' } });
    const session = await window.fixtureClient.authenticate();
    try { await window.fixtureClient.play({ amount: session.config.defaultBetAmount, mode: sdk.stakeBetMode('BASE') }); throw new Error('unexpected'); }
    catch (error) { if (!(error instanceof sdk.StakeSdkError) || error.category !== 'AMBIGUOUS_PAID_DISPATCH') throw error; }
  });
  await first.close();
  const result = await second.evaluate(async () => {
    const sdk: typeof import('../src/index.js') = await import(`${location.origin}/sdk/index.js`);
    const launch = sdk.parseStakeLaunch(`?sessionID=fake-uncertain&rgs_url=${location.origin}`, { allowHttp: true }); if (launch.kind !== 'LIVE') throw new Error('launch');
    const codec = { parse(input: unknown) { if (input === null || typeof input !== 'object' || !('value' in input) || typeof input.value !== 'number') throw new Error('state'); return { value: input.value }; } };
    let requests = 0;
    const fetchImpl: typeof fetch = async (url, init) => { requests++; return fetch(url, init); };
    const client = sdk.createStakeLiveClient({ launch, codec, fetch: fetchImpl, sessionLease: { kind: 'WEB_LOCKS' } });
    const session = await client.authenticate(); let blocked = '';
    try { await client.play({ amount: session.config.defaultBetAmount, mode: sdk.stakeBetMode('BASE') }); } catch (error) { if (!(error instanceof sdk.StakeSdkError)) throw error; blocked = error.code; }
    const before = (await navigator.locks.query()).held?.length;
    const replayLaunch = sdk.parseStakeLaunch(`?replay=true&rgs_url=${location.origin}&game=fake&version=1&mode=BASE&event=1`, { allowHttp: true });
    if (replayLaunch.kind !== 'REPLAY') throw new Error('launch');
    const replay = sdk.createStakeReplayClient({ launch: replayLaunch, codec }); await replay.acquire(); replay.destroy();
    const after = (await navigator.locks.query()).held?.length;
    client.destroy();
    return { blocked, requests, before, after };
  });
  expect(result).toEqual({ blocked: 'RECONCILIATION_REQUIRED', requests: 1, before: 1, after: 1 }); await second.close();
});
