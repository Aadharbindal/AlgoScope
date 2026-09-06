/**
 * The durable signal store, against a server that really answers.
 *
 * The confusion map is the one thing on this site that compounds, and it only
 * compounds if the rows survive the instance that wrote them. That claim is
 * worth more than a comment, so this stands up a stub speaking the same REST
 * dialect the real service does — `POST /` with a command as a JSON array,
 * `POST /pipeline` with several, `{ result }` or `{ error }` back — and drives
 * the adapter through it.
 *
 * A stub rather than a live database on purpose. What is being checked is this
 * project's half of the contract: that the right commands go out, that rows
 * come back parsed, that a corrupt row is skipped rather than repaired, and —
 * the part that matters most — that an unreachable store degrades to "not
 * durable" and says so, instead of throwing inside an ingest route or quietly
 * claiming a history it does not have.
 *
 * Run: npx tsx scripts/redis.ts
 */
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { redisCredentials, redisStore } from '../src/lib/signals/redis';
import { SessionSignal, SIGNAL_VERSION } from '../src/lib/signals/types';

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`);
  if (!cond) failures++;
};

function signal(over: Partial<SessionSignal> = {}): SessionSignal {
  return {
    v: SIGNAL_VERSION,
    session: 'abcdef0123456789',
    slug: 'binary-search',
    lang: 'cpp',
    mutations: [],
    input: '1,2,3|3',
    steps: 12,
    visited: [{ i: 0, line: 5, visits: 1, dwell: 900 }],
    checkpoints: [],
    divergedAtLine: null,
    lastLine: 5,
    finished: true,
    duration: 30,
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* A stub that speaks the REST dialect, and remembers what it was told. */

type Command = (string | number)[];

interface Stub {
  server: Server;
  url: string;
  /** The list, as the server holds it. */
  rows: string[];
  /** Every command received, so the shape of the request can be asserted. */
  seen: Command[];
  /** Authorization headers received. */
  auth: (string | undefined)[];
  /** When set, every request fails this way. */
  mode: 'ok' | 'error' | 'status500';
  stop(): Promise<void>;
}

function run(stub: Stub, cmd: Command): unknown {
  const name = String(cmd[0]).toUpperCase();
  if (name === 'RPUSH') {
    stub.rows.push(String(cmd[2]));
    return stub.rows.length;
  }
  if (name === 'LTRIM') {
    // Only the negative form this adapter uses is modelled; anything else
    // would be a stub pretending to be Redis rather than checking one caller.
    const start = Number(cmd[2]);
    if (start < 0) stub.rows = stub.rows.slice(start);
    return 'OK';
  }
  if (name === 'LRANGE') {
    const start = Number(cmd[2]);
    return start < 0 ? stub.rows.slice(start) : stub.rows.slice(start);
  }
  if (name === 'LLEN') return stub.rows.length;
  throw new Error(`stub got an unexpected command: ${name}`);
}

async function stubServer(): Promise<Stub> {
  const stub: Partial<Stub> = { rows: [], seen: [], auth: [], mode: 'ok' };

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      stub.auth!.push(req.headers.authorization);

      if (stub.mode === 'status500') {
        res.writeHead(500).end('nope');
        return;
      }
      if (stub.mode === 'error') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'WRONGPASS invalid password' }));
        return;
      }

      const parsed = JSON.parse(body) as Command | Command[];
      const pipeline = req.url === '/pipeline';
      const commands = (pipeline ? parsed : [parsed]) as Command[];
      stub.seen!.push(...commands);

      const results = commands.map((c) => ({ result: run(stub as Stub, c) }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(pipeline ? results : results[0]));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  stub.server = server;
  stub.url = `http://127.0.0.1:${port}`;
  stub.stop = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return stub as Stub;
}

const creds = (url: string) => ({ url, token: 'test-token' });

/* ------------------------------------------------------------------ */

async function main(): Promise<number> {
  const stub = await stubServer();

  console.log('\n=== a row written is a row read back ===');
  {
    const store = redisStore(creds(stub.url));
    await store.append(signal({ session: 'aaaaaaaaaaaaaaaa' }));
    await store.append(signal({ session: 'bbbbbbbbbbbbbbbb' }));

    const back = await store.read(50);
    ok(back.length === 2, `both rows come back (${back.length})`);
    ok(
      back.map((r) => r.session).join(',') === 'aaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbb',
      'in the order they were written, oldest first',
    );

    const status = await store.status();
    ok(status.durable, 'the store reports itself durable while the server answers');
    ok(status.rows === 2, `and counts the rows it holds (${status.rows})`);
    ok(
      status.bytes === null,
      'bytes is null rather than a number nobody measured — Redis will not say cheaply',
    );
  }

  console.log('\n=== the commands are the ones intended ===');
  {
    const names = stub.seen.map((c) => String(c[0]).toUpperCase());
    ok(names.includes('RPUSH'), 'an append is an RPUSH, so the newest row is last');
    ok(names.includes('LTRIM'), 'and is followed by an LTRIM, so the list is capped on write');
    ok(
      stub.seen.filter((c) => String(c[0]).toUpperCase() === 'LRANGE').length === 1,
      'a read is one LRANGE, not a row-by-row walk',
    );
    ok(
      stub.auth.every((a) => a === 'Bearer test-token'),
      'every request carries the bearer token',
    );
    const trim = stub.seen.find((c) => String(c[0]).toUpperCase() === 'LTRIM')!;
    ok(
      Number(trim[2]) < 0 && Number(trim[3]) === -1,
      `LTRIM keeps the newest window, not the oldest (${trim[2]} to ${trim[3]})`,
    );
  }

  console.log('\n=== a corrupt row is skipped, not repaired ===');
  {
    stub.rows.push('{ this is not json');
    stub.rows.push(JSON.stringify({ v: SIGNAL_VERSION, slug: 'no-such-algorithm' }));
    stub.rows.push(JSON.stringify(signal({ session: 'cccccccccccccccc' })));

    const store = redisStore(creds(stub.url));
    const back = await store.read(50);
    ok(back.length === 3, `two unusable rows are dropped and three good ones remain (${back.length})`);
    ok(
      back.some((r) => r.session === 'cccccccccccccccc'),
      'a good row after a corrupt one is still read',
    );
  }

  console.log('\n=== an unreachable store degrades honestly ===');
  {
    // The important case. Ingest must not throw, the rows must not be silently
    // discarded, and the page must not be told a history exists that does not.
    const store = redisStore(creds('http://127.0.0.1:9')); // discard port: refuses
    let threw = false;
    try {
      await store.append(signal({ session: 'dddddddddddddddd' }));
    } catch {
      threw = true;
    }
    ok(!threw, 'append does not throw, so the ingest route cannot 500 on a dead database');

    const status = await store.status();
    ok(!status.durable, 'and the store reports itself not durable');

    const back = await store.read(50);
    ok(
      back.length === 1 && back[0].session === 'dddddddddddddddd',
      'the row it could not write is still readable from this instance',
    );
  }

  console.log('\n=== a refused credential is a failure, not an empty history ===');
  {
    stub.mode = 'error';
    const store = redisStore(creds(stub.url));
    await store.append(signal());
    const status = await store.status();
    ok(!status.durable, 'an { error } reply is treated as the store being unavailable');
    ok(status.rows === 1, `the unwritten row is still accounted for (${status.rows})`);

    stub.mode = 'status500';
    const other = redisStore(creds(stub.url));
    const s2 = await other.status();
    ok(!s2.durable, 'so is a non-2xx status');
    stub.mode = 'ok';
  }

  console.log('\n=== the cap drops the oldest, and says so ===');
  {
    const store = redisStore(creds(stub.url), 5);
    stub.rows = [];
    for (let i = 0; i < 12; i++) await store.append(signal({ session: String(i).repeat(16) }));

    const back = await store.read(100);
    ok(back.length === 5, `only the cap's worth is kept, not everything written (${back.length})`);
    ok(
      back[back.length - 1].session === String(11).repeat(16),
      'the newest session survives',
    );
    ok(
      !back.some((r) => r.session === '0'.repeat(16)),
      'and the oldest is the one dropped',
    );

    const status = await store.status();
    ok(
      status.capped && status.keeps === 5,
      'status says the store is at its cap, so the page can say it is showing a window',
    );
  }

  console.log('\n=== credentials are found under the names platforms use ===');
  {
    const saved = { ...process.env };
    for (const k of [
      'ALGOSCOPE_REDIS_REST_URL', 'ALGOSCOPE_REDIS_REST_TOKEN',
      'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
      'KV_REST_API_URL', 'KV_REST_API_TOKEN',
    ]) delete process.env[k];

    ok(redisCredentials() === null, 'with nothing configured, there are no credentials and the file store is used');

    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io/';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
    const found = redisCredentials();
    ok(found?.url === 'https://example.upstash.io', 'the Upstash names are recognised, trailing slash trimmed');

    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.KV_REST_API_URL = 'https://example.kv.vercel-storage.com';
    process.env.KV_REST_API_TOKEN = 'tok';
    ok(redisCredentials() !== null, "Vercel's own names are recognised too");

    process.env = saved;
  }

  await stub.stop();

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().then((code) => process.exit(code));
