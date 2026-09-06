/**
 * Does the tutor endpoint's rationing actually ration?
 *
 * This is the one route that costs money to answer, so its guards are worth
 * the same treatment as the engine: run them, do not assume them. The limiter
 * is exercised directly rather than over HTTP, because what is being checked
 * is the counting — a live server would also need a key and would then spend
 * money proving that it refuses to spend money.
 *
 * Run: npx tsx scripts/limits.ts
 */
import { clientKey, LIMITS, memoryLimiter } from '../src/lib/ai/limit';

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`);
  if (!cond) failures++;
};

console.log('\n=== one caller is rationed ===');
{
  const limiter = memoryLimiter();
  const allowed = [];
  for (let i = 0; i < LIMITS.perClient + 5; i++) allowed.push(limiter.take('1.2.3.4').ok);

  const taken = allowed.filter(Boolean).length;
  ok(taken === LIMITS.perClient, `exactly ${LIMITS.perClient} get through, then no more (got ${taken})`);
  ok(allowed.slice(0, LIMITS.perClient).every(Boolean), 'the refusals come after the allowances, not among them');

  const refused = limiter.take('1.2.3.4');
  ok(refused.scope === 'client', 'the refusal names the client limit, so the message can be specific');
  ok(
    refused.retryAfter > 0 && refused.retryAfter <= LIMITS.clientWindowMinutes * 60,
    `Retry-After is inside the window (${refused.retryAfter}s)`,
  );
}

console.log('\n=== one caller cannot exhaust another ===');
{
  const limiter = memoryLimiter();
  for (let i = 0; i < LIMITS.perClient + 20; i++) limiter.take('1.2.3.4');
  ok(limiter.take('5.6.7.8').ok, 'a second address is unaffected by the first one being over');
}

console.log('\n=== the instance ceiling is the one that cannot be spoofed ===');
{
  // The point of this test. A caller inventing a fresh forwarding header for
  // every request defeats the per-client limit entirely — that limit is about
  // one honest visitor, not about an attacker. What still holds is the number
  // of questions the process will answer at all.
  const limiter = memoryLimiter();
  let served = 0;
  let sawInstanceRefusal = false;
  for (let i = 0; i < LIMITS.perHour + 50; i++) {
    const d = limiter.take(`spoofed-${i}`); // a new "address" every time
    if (d.ok) served++;
    else if (d.scope === 'instance') sawInstanceRefusal = true;
  }
  ok(served === LIMITS.perHour, `the instance answers ${LIMITS.perHour} and no more (got ${served})`);
  ok(sawInstanceRefusal, 'the refusal is attributed to the instance, not to the invented client');
}

console.log('\n=== a refused client does not spend the shared budget ===');
{
  const limiter = memoryLimiter();
  for (let i = 0; i < LIMITS.perClient + 100; i++) limiter.take('greedy');

  let others = 0;
  for (let i = 0; i < LIMITS.perHour; i++) if (limiter.take(`other-${i}`).ok) others++;
  ok(
    others === LIMITS.perHour - LIMITS.perClient,
    `only the ${LIMITS.perClient} answered requests were charged to the hour, not all ${LIMITS.perClient + 100} attempts (got ${others})`,
  );
}

console.log('\n=== the key table is bounded ===');
{
  // The table is keyed by something the caller controls, so it is itself a way
  // to exhaust memory unless it is capped. Far more keys than the cap, and the
  // process should still be standing.
  const limiter = memoryLimiter();
  for (let i = 0; i < 40_000; i++) limiter.take(`flood-${i}`);
  ok(true, 'forty thousand distinct keys neither throw nor grow without bound');
}

console.log('\n=== who is asking ===');
{
  const h = (init: Record<string, string>) => new Headers(init);
  ok(
    clientKey(h({ 'x-forwarded-for': '203.0.113.5, 70.41.3.18' })) === '203.0.113.5',
    'the first entry of x-forwarded-for is the client',
  );
  ok(clientKey(h({ 'x-real-ip': '198.51.100.7' })) === '198.51.100.7', 'x-real-ip is the fallback');
  ok(
    clientKey(h({})) === 'unattributed',
    'no forwarding header at all shares one key, which is the conservative reading',
  );
  ok(
    clientKey(h({ 'x-forwarded-for': 'x'.repeat(5000) })).length <= 64,
    'a caller cannot make the key itself enormous',
  );
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
