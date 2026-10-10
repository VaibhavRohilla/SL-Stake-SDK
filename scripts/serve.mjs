import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const balance = { amount: 10_000_000, currency: 'USD' };
const round = { betID: 'fake-browser-round', amount: 1_000_000, active: true, mode: 'BASE', state: { value: 7 }, payout: 2_000_000 };
const auth = { balance, round: null, config: { minBet: 100_000, maxBet: 10_000_000, stepBet: 100_000, defaultBetLevel: 1_000_000, betLevels: [100_000, 1_000_000], jurisdiction: { socialCasino: false, disabledFullscreen: false, disabledTurbo: false, disabledSuperTurbo: false, disabledAutoplay: false, disabledSlamstop: false, disabledSpacebar: false, disabledBuyFeature: false, displayNetPosition: false, displayRTP: false, displaySessionTimer: false, minimumRoundDuration: 0 } } };
createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path.startsWith('/sdk/') && /^\/sdk\/[A-Za-z]+\.js$/.test(path)) {
    try { response.setHeader('content-type', 'text/javascript'); response.end(await readFile(new URL(`../dist/${path.slice(5)}`, import.meta.url))); }
    catch { response.writeHead(404).end(); }
    return;
  }
  if (path === '/') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>Stake SDK browser proof</title>'); return; }
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const data = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const payload = path === '/wallet/authenticate' ? auth : path === '/wallet/play' ? { balance, round }
    : path === '/bet/event' ? { event: data.event } : path === '/wallet/end-round' ? { balance }
    : { state: { value: 7 }, payoutMultiplier: 2, costMultiplier: 1 };
  response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(payload));
}).listen(4179, '127.0.0.1');
