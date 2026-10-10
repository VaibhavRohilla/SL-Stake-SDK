import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = await mkdtemp(join(tmpdir(), 'stake-sdk-consumer-'));
const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--cache', join(output, 'cache'), '--pack-destination', output], { cwd: root, encoding: 'utf8' }))[0];
for (const file of packed.files) {
  assert.ok(file.path.startsWith('dist/') || ['README.md', 'LICENSE', 'package.json'].includes(file.path), `Unexpected packed file: ${file.path}`);
  if (file.path.endsWith('.js') || file.path.endsWith('.d.ts')) {
    const content = await readFile(join(root, file.path), 'utf8');
    assert.ok(!content.includes(root), 'Packed declarations/runtime contain a local source path');
  }
}
assert.ok(packed.files.some(file => file.path === 'dist/index.d.ts'));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.equal(manifest.name, '@fnx/stake-sdk');
assert.equal(manifest.type, 'module');
assert.deepEqual(manifest.dependencies ?? {}, {});
assert.deepEqual(manifest.peerDependencies ?? {}, {});
assert.deepEqual(manifest.optionalDependencies ?? {}, {});
assert.deepEqual(Object.keys(manifest.exports), ['.']);
await writeFile(join(output, 'package.json'), JSON.stringify({ type: 'module', private: true }));
execFileSync('npm', ['install', '--cache', join(output, 'cache'), '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(output, packed.filename)], { cwd: output, stdio: 'pipe' });
const consumer = `
import assert from 'node:assert/strict';
import { parseStakeLaunch, createStakeLiveClient, createStakeReplayClient, stakeAmountMicros, StakeSdkError } from '@fnx/stake-sdk';
import type { StakeGameStateCodec, StakeReplayClient } from '@fnx/stake-sdk';
type Assert<T extends true> = T;
export type ReplaySafe = Assert<Extract<keyof StakeReplayClient<number>, 'play' | 'recordEvent' | 'endRound'> extends never ? true : false>;
const codec: StakeGameStateCodec<number> = { parse(input) { if (typeof input !== 'number') throw new Error('invalid state'); return input; } };
const balance = { amount: 10000000, currency: 'BTC' };
const config = { minBet: 1000000, maxBet: 1000000, stepBet: 1000000, defaultBetLevel: 1000000, betLevels: [1000000] };
const round = { betID: 'fake-consumer-round', amount: 1000000, active: true, mode: 'BASE', state: 7 };
const calls: string[] = [];
const fetchImpl: typeof fetch = async (url, init) => {
  const path = new URL(String(url)).pathname; calls.push(path);
  const payload = path === '/wallet/authenticate' ? { balance, config, round: null } : path === '/wallet/play' ? { balance, round }
    : path === '/bet/event' ? { event: 'checkpoint' } : path === '/wallet/end-round' ? { balance }
    : { state: 7, payoutMultiplier: 2, costMultiplier: 1 };
  if (path === '/wallet/play') assert.equal(JSON.parse(String(init?.body)).currency, 'BTC');
  return Response.json(payload);
};
const launch = parseStakeLaunch('?sessionID=fake-consumer&rgs_url=rgs.example');
if (launch.kind !== 'LIVE') throw new Error('launch');
const client = createStakeLiveClient({ launch, codec, fetch: fetchImpl });
await client.authenticate(); const result = await client.play({ amount: stakeAmountMicros(1000000), mode: 'BASE' });
assert.equal(result.round.state, 7); await client.recordEvent(result.round.betID, 'checkpoint'); await client.endRound(result.round.betID); client.destroy();
const replayLaunch = parseStakeLaunch('?replay=true&rgs_url=rgs.example&game=fake&version=1&mode=BASE&event=55');
if (replayLaunch.kind !== 'REPLAY') throw new Error('launch');
const replay = createStakeReplayClient({ launch: replayLaunch, codec, fetch: fetchImpl }); assert.equal((await replay.acquire()).state, 7); replay.destroy();
assert.equal(calls.length, 5);
try { await client.authenticate(); throw new Error('destroy guard'); } catch (error) { assert.ok(error instanceof StakeSdkError); assert.equal(error.category, 'LIFECYCLE'); }
const privatePath = '@fnx/stake-sdk/dist/request.js';
await assert.rejects(import(privatePath), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
console.log('Installed public ESM/DTS live + replay consumer PASS');
`;
await writeFile(join(output, 'consumer.ts'), consumer);
await writeFile(join(output, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: true, outDir: 'out', typeRoots: [join(root, 'node_modules/@types')] }, include: ['consumer.ts'] }));
execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(output, 'tsconfig.json')], { cwd: output, stdio: 'inherit' });
execFileSync(process.execPath, [join(output, 'out/consumer.js')], { cwd: output, stdio: 'inherit' });
console.log('Package whitelist/private exports/dependency isolation PASS');
console.log('Tarball:', join(output, packed.filename));
console.log('Clean consumer:', output);
