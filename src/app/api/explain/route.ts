import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { clientKey, LIMITS, tutorLimiter } from '@/lib/ai/limit';
import { ExplainPayload, groundedNumbers } from '@/lib/ai/payload';

/**
 * The AI layer.
 *
 * It receives a state payload built from an execution trace and is asked to
 * phrase it. It is never asked what happened — the trace already knows, and
 * nothing this route returns reaches the visualization. If this endpoint is
 * removed entirely, the product still works.
 *
 * Two guardrails on what it says:
 *   1. The system prompt forbids arithmetic and invented figures.
 *   2. Every number in the reply is checked against the payload afterwards,
 *      and anything unaccounted for is reported to the reader rather than
 *      quietly shown as fact.
 *
 * And two on what it costs, because this is the one route on the site that
 * spends money to answer: a bounded body, and a rate limit per caller and per
 * instance. See `lib/ai/limit.ts` for which of those two is load-bearing.
 */

const SYSTEM = `You are a tutor sitting beside a student who is stepping through a real execution trace of an algorithm.

You will be given a JSON payload containing the exact program state at one step: the executing line, the variables before and after, the arrays, the operation counters, and whether the algorithm's invariant currently holds. This payload is the complete and only source of truth.

Rules, in order of importance:
1. Never state a number, index, or value that does not appear in the payload. Do not compute new figures — no sums, averages, or projections. If answering would require a number you were not given, say which number you would need instead of producing one.
2. Never claim what happens at a step other than the one you were given. You cannot see other steps.
3. Never say the code is correct or incorrect, and never state a time or space complexity. Those come from measurement elsewhere in the product, not from you.
4. If the payload does not contain enough to answer, say so plainly in one sentence.

Style: address the student directly as "you". Two to four sentences, no headings, no bullet points, no markdown emphasis. Explain the reasoning behind the state rather than restating the variables. Prefer the algorithm's own vocabulary — search window, invariant, pivot, frontier.`;

/**
 * The most a real payload can be.
 *
 * The largest one this catalogue produces — grid-bfs, whose payload carries a
 * maze and a full code listing — is a little under 2 KB, measured rather than
 * guessed. 32 KB leaves better than fifteen times that headroom and still
 * bounds what can be pushed through to the model, which matters because the
 * payload is forwarded as input tokens: capping the *question* at 500
 * characters while leaving the body unbounded would have been a lock on the
 * door of an open window.
 */
const MAX_BODY_BYTES = 32 * 1024;

export async function POST(req: NextRequest) {
  // Cheapest refusals first: nothing below this point should run for a caller
  // who is over their limit, least of all the model call.
  const verdict = tutorLimiter.take(clientKey(req.headers));
  if (!verdict.ok) {
    return NextResponse.json(
      {
        error:
          verdict.scope === 'client'
            ? `That is more than ${LIMITS.perClient} questions in ${LIMITS.clientWindowMinutes} minutes. Everything else on the page keeps working — the tutor is the only part that rations.`
            : 'This instance has answered as many questions as it will this hour. Nothing else on the page is affected.',
      },
      { status: 429, headers: { 'Retry-After': String(verdict.retryAfter) } },
    );
  }

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
  }

  // A declared length can lie, so the body is measured as it is read rather
  // than trusted from the header.
  let body: string;
  try {
    body = await req.text();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }
  // Measured in bytes, like the header it is checking behind — a string's
  // length is UTF-16 units, and comparing those to a byte budget would let a
  // body of multi-byte characters through at several times the cap.
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
  }

  let payload: ExplainPayload;
  try {
    payload = JSON.parse(body) as ExplainPayload;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  if (!payload?.question || typeof payload.question !== 'string') {
    return NextResponse.json({ error: 'No question was asked.' }, { status: 400 });
  }
  if (payload.question.length > 500) {
    return NextResponse.json({ error: 'Question is too long.' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          'The AI tutor is not configured on this instance. Everything else — the trace, the invariant, the divergence finder — works without it.',
      },
      { status: 503 },
    );
  }

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      messages: [
        {
          role: 'user',
          content: `Program state at this step:\n\n${JSON.stringify(
            { ...payload, question: undefined },
            null,
            1,
          )}\n\nThe student asks: ${payload.question}`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json(
        { error: 'The model declined to answer that.' },
        { status: 422 },
      );
    }

    const answer = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // Grounding check: any figure not present in the payload is surfaced as
    // unverified rather than presented as fact.
    const allowed = groundedNumbers(payload);
    const cited = answer.match(/-?\d+(\.\d+)?/g) ?? [];
    const unverified = [...new Set(cited.filter((n) => !allowed.has(n)))];

    return NextResponse.json({
      answer,
      unverified,
      grounded: unverified.length === 0,
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Rate limited — try again shortly.' }, { status: 429 });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'The configured API key was rejected.' }, { status: 502 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `The tutor service returned ${error.status}.` },
        { status: 502 },
      );
    }
    return NextResponse.json({ error: 'The tutor service is unreachable.' }, { status: 502 });
  }
}
