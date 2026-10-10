import { createServer } from 'node:http';
import { once } from 'node:events';
import { it, expect } from 'vitest';
import { stakeBetMode, stakeEventId, createStakeLiveClient, parseStakeLaunch, stakeAmountMicros, createStakeReplayClient } from '../src/index.js';
import { auth, played, balance, codec } from './fixtures.js';
it('platform fetch drives live recovery/event/end and replay through real HTTP', async () => {
  const requests: { method: string | undefined; path: string | undefined; body: unknown }[] = [];
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += String(chunk);
    requests.push({ method: request.method, path: request.url, body: body ? JSON.parse(body) : null });
    const payload = request.url === '/wallet/authenticate' ? auth : request.url === '/wallet/play' ? played
      : request.url === '/bet/event' ? { event: 'checkpoint' } : request.url === '/wallet/end-round' ? { balance }
      : { state: { value: 7 }, payoutMultiplier: 2, costMultiplier: 1 };
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(payload));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (address === null || typeof address === 'string') throw new Error('server address');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const launch = parseStakeLaunch(`?sessionID=fake-http&rgs_url=${base}`, { allowHttp: true }); if (launch.kind !== 'LIVE') throw new Error('launch');
    const client = createStakeLiveClient({ launch, codec }); await client.authenticate();
    const result = await client.play({ amount: stakeAmountMicros(1_000_000), mode: stakeBetMode('BASE') });
    await client.recordEvent(result.round.betID, stakeEventId('checkpoint')); await client.endRound(result.round.betID); client.destroy();
    const replayLaunch = parseStakeLaunch(`?replay=true&rgs_url=${base}&game=fake&version=1&mode=BASE&event=1`, { allowHttp: true });
    if (replayLaunch.kind !== 'REPLAY') throw new Error('launch');
    const replay = createStakeReplayClient({ launch: replayLaunch, codec }); expect((await replay.acquire()).state).toEqual({ value: 7 }); replay.destroy();
    expect(requests.map(request => request.path)).toEqual(['/wallet/authenticate', '/wallet/play', '/bet/event', '/wallet/end-round', '/bet/replay/fake/1/BASE/1']);
    expect(requests[1]?.body).toEqual({ sessionID: 'fake-http', amount: 1_000_000, currency: 'USD', mode: stakeBetMode('BASE') });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
