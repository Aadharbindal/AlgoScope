# AlgoScope

[![verify](https://github.com/Aadharbindal/AlgoScope/actions/workflows/verify.yml/badge.svg)](https://github.com/Aadharbindal/AlgoScope/actions/workflows/verify.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A semantic debugger for algorithms.

Most algorithm visualisers animate a canned implementation. Most debuggers show you variables with no idea what they mean. AlgoScope sits in the gap: it runs an instrumented implementation, produces an execution trace, and then interprets that trace in algorithm-level terms — this is a search window, these indices are ruled out, this invariant just broke.

**The design rule everything follows: the trace is the only source of truth.** The picture is a rendering of it, the complexity is measured from it, and the AI layer may only phrase facts already in it. Delete the AI layer entirely and the product still works — that is the test.

---

## Running it

```bash
npm install
npm run dev
```

Everything runs in the browser. Algorithms are TypeScript generator-style functions that emit trace steps, so custom input, stepping, backward scrubbing and complexity measurement need no server. Code the reader writes runs in the browser too — their own JavaScript in the page's engine, their C, C++ or Java on an interpreter written for this project. Nothing is uploaded, and code is never read from a link.

Four server routes exist and none of them is on the path between a reader and an algorithm:
`/api/og` renders a link preview of a step, `/api/oembed` describes the embeddable player,
`/api/signal` receives the anonymous per-session summary behind the confusion map, and `/api/explain`
is the optional tutor panel. Without a key that last one returns a clear 503 and the rest of the app
is unaffected:

```bash
# .env.local
ANTHROPIC_API_KEY=sk-ant-...
```

## Deploying it

Three features — link previews, oEmbed and the embeddable player — hand crawlers
absolute URLs, so they do nothing at all until the site has a public origin. That
is a switch, not a task:

```bash
NEXT_PUBLIC_SITE_URL=https://your-domain    # required off Vercel; on Vercel the
                                            # platform host is used when unset
ANTHROPIC_API_KEY=...                       # optional, tutor panel only
```

With that set, `/api/og` renders a real trace step as a PNG, `/api/oembed`
returns an iframe for it, and every algorithm page carries the matching
`og:` tags. All three are verifiable with `curl` against a local
`next start` before any of it is public.

Two things worth knowing before it is:

- **The tutor rations itself.** `/api/explain` bounds its request body and
  limits requests per client and per instance, because it is the only route
  that costs money to answer. The per-instance ceiling is the one that bounds
  the bill; `ALGOSCOPE_TUTOR_PER_HOUR` is the knob. Both counters live in the
  process, so several instances multiply them — `RateLimiter` in
  `src/lib/ai/limit.ts` is the seam to replace for a hard cap.
- **Signals need a database off a real disk.** With no credentials the
  confusion map appends to a file, which is right for a machine that owns its
  own disk and useless on a serverless host, where the filesystem does not
  survive the instance. Attach a Redis database and it is picked up
  automatically — the names Upstash's and Vercel's own integrations set are
  recognised, so there is nothing to rename. The insights page names the store
  it is actually reading, and says when it is showing a window rather than the
  whole history.


## Verifying it

```bash
npm run verify     # all six suites below, in order — run this before trusting any output
npm run smoke      # engine correctness, per algorithm and per ladder
npm run usercheck  # the user-code lane catches deliberately broken programs
npm run signals    # the confusion map aggregates what it was given, and refuses what it was not
npm run interp     # the C-family interpreter: maps, structs, containers, 32-bit ints
npm run limits     # the tutor endpoint's rationing actually rations
npm run redis      # the durable signal store, against a server that really answers
npm run lint
npm run build      # add --webpack if Turbopack fails to spawn its PostCSS worker
```

`npm run smoke` is the important one. For every algorithm it asserts:

1. the lens invariant holds at every step of a known-correct run,
2. every buggy variant has a **discoverable counterexample** (an input on which it provably diverges),
3. measured growth matches the declared complexity,
4. every emitted line number exists in the displayed source, and no step lacks narration,
5. every mutation really rewrites the source, keeps the line count stable, and really changes behaviour,
6. every user-lane starter parses, runs, and agrees with the reference on every candidate input, in
   every language the lane offers,
7. every checkpoint locates a step that really occurs, and its answer is among its own options.

`npm run usercheck` proves the other direction: fifteen classic bugs written as user code are each
caught, with the smallest input that exposes them.

It has already caught several real bugs during development — a variant that never diverged on the
default input, an invariant that was simply wrong, a linked-list run that emitted no countable
operations, and a step cap that stopped *recording* a run without stopping the run.

---

## Algorithms

Twenty-three, chosen so that between them they exercise every visual primitive rather than to pad
a list.

| Category | Algorithms |
|---|---|
| Searching | Linear Search · Binary Search · Two Sum (sorted) · Two Sum (unsorted, with a map) · Next Greater Element |
| Sorting | Bubble · Selection · Insertion · Merge · Quick |
| Linked lists | Reverse a Linked List · Cycle Detection (Floyd's) |
| Trees | In-order Traversal · Level-order Traversal (BFS) |
| Graphs | Shortest Path in a Grid (BFS) · Breadth-first Search · Depth-first Search · Topological Sort (Kahn's) · Dijkstra's Shortest Path |
| Dynamic programming | Maximum Subarray — brute force · running total · Kadane's · Edit Distance |

Each ships a mutation set, named variants, edge cases, a checked loop invariant, predict-then-reveal
checkpoints, and a lane the reader can write their own version in. Three of them are also arranged
into **approach ladders** — the same problem solved several ways, asserted to agree on every input
and never to worsen the complexity class going up.

Where a category has more than one implementation of one problem, that is the point: brute force,
running total and Kadane's are the same question answered three times, and the ladder page measures
all three rather than asserting which is faster.

### Three kinds of claim

An invariant is a claim about **every step**. A postcondition is a claim about the **result**,
checked only at the last one. A cost claim is a claim about the **work done**, checked against the
counters where they are final.

The distinctions are not academic, and each was forced by a bug the previous kind could not see. A
binary search that stops one round early keeps the target inside its window for the whole run — the
invariant holds at every step — and then returns −1 for a value that was sitting there. That is the
postcondition's job.

The third kind exists because five authored bugs escaped both. They all escaped the same way: the
right answer by the wrong route. Reading one element past the end, comparing a pair already known to
be in order, swapping an element with an equal one, skipping a copy whose elements happened to be in
place. Nothing observable in the state is wrong, because nothing observable in the state *is* wrong.
What is wrong is the amount of work, and only the counters hold that.

`npm run smoke` asserts that **every** authored bug breaks one of the three. A new algorithm whose
bug nothing catches fails the suite, and the fix is to write the claim that catches it.

### Mutations

A mutation is one editable decision in the source — `<=` becoming `<`, `mid + 1` becoming `mid`.
Switching one on rewrites that line, re-runs the trace, and locates the divergence. **A named
"buggy variant" is just a preset: a named point in mutation space**, which is why the palette and
the Bug Lab share all their machinery.

Every edit is scoped to a single line and never changes the line count, so `t.step(line, …)` stays
valid under any combination. That is not incidental — the previous design deleted whole lines and
silently shifted every line number below the edit, so the code panel highlighted the wrong
statement.

### The user-code lane

Every algorithm has one, in up to four languages. Both lanes produce exactly the same `Trace` the
built-in algorithms produce, so the player, timeline, code panel and counterexample search work on
code we have never seen, unchanged.

- **JavaScript** — `src/lib/usercode/instrument.ts` parses the reader's source with acorn, splices a
  `yield` in front of every statement, turns the function into a generator and drives it. Fast and
  complete, but it sees only statement boundaries: comparison and read counts are *not* measured, so
  they stay at zero and are not displayed.
- **C, C++ and Java** — `src/lib/interp/` is a lexer, parser and tree-walking interpreter written for
  this project. A narrower subset of each language, but every operation passes through it, so the
  counters are measured rather than estimated, recursion is traced into helpers, and `int` is a real
  32-bit int — which is the only way `(low + high) / 2` can be shown overflowing, a bug JavaScript is
  structurally unable to reproduce.

The interpreter refuses rather than guesses, and that is most of its design:

- Reading past the end of an array stops the run. In real C this would return whatever was in
  memory; inventing a value here would make the trace a lie.
- `queue::pop` takes from the front and `stack::pop` from the back, because a declared container
  remembers what it was declared as. Java's `Deque.push` works on the opposite end from C++'s, so
  both names are refused on a `Deque` by name.
- A method that does not exist is named in the error rather than ignored.
- A struct constructor is refused *by name*. Skipping it would leave `new Node(7)` filling the
  fields positionally, which is right for the usual `Node(int v) : val(v), next(nullptr) {}` and
  silently wrong for a constructor that computes anything.

**What the subset covers is decided by evidence, not by taste.** The list of refusals was once
written from memory — strings, pointers, templates — and running the actual listings on this site
through the parser said otherwise. What it found:

- `int&` parsed, ran, and threw the callee's writes away. Not a refusal: a **wrong answer with no
  error**, which is the one outcome this interpreter exists to prevent. A scalar reference now
  reaches the caller, and two reference parameters bound to the same variable are refused rather
  than resolved, because which copy-back wins would decide the answer.
- Four of the C listings on this site did not parse in the C lane that offers them, all on `int* k`.
  A reader's obvious first move is to copy what is on the screen, and it was a wall built out of the
  site's own example. Pointers to locals now work; so do `#include`, `using namespace std;`,
  `INT_MAX` / `Integer.MAX_VALUE`, braced pairs, and `auto [a, b]`.
- **`npm run smoke` now parses all sixty-nine displayed listings** in the lane each is offered in, so
  this cannot drift back.

What is still refused, and why it is a choice rather than a gap: `sort(v.begin(), v.end())`, on a
site about writing the sort yourself. What is still refused because nothing has needed it: writing
to a string, `substr`, and templates, which parse but are not modelled.

**What each parameter receives is stated, not guessed.** A lane declares its binding — an array, a
linked list, a tree of nodes, a maze, an adjacency list, a pair of words — and the editor prints the
same list underneath the box. The reader writes the function, not the scaffolding to build its
input.

One honest limit, stated in the UI as well as here: there is **no step-by-step divergence against
the reference**. Two correct implementations of binary search take different steps, so diffing them
is meaningless. The comparison is on the *answer*, across every candidate input, reporting the
smallest one that disagrees.

## Architecture

```
source ──▶ instrumented run ──▶ raw trace ──▶ lens ──▶ visual state ──▶ player
                                    │           │
                                    └───────────┴──▶ AI layer (read-only, prose out)
```

No arrow runs from the AI layer back into the trace, the lens, or the visual state. That absence is the architecture.

### `src/lib/trace/` — the contract

| File | Role |
|---|---|
| `types.ts` | `Trace`, `Step`, `Struct`, `Lens`. Each step is **self-contained**, which is what makes backward scrubbing O(1). |
| `tracer.ts` | The API algorithms write against. `trace` mode records snapshots; `count` mode keeps only counters, so the same source can be re-run at n = 10⁶ for growth measurement. |
| `expr.ts` | A ~200-line expression evaluator for lens specs. Deliberately not `new Function` — lenses will eventually be machine-generated, and evaluating those as JavaScript is how that becomes a security incident. |
| `lens.ts` | Resolves a lens against a step, and **validates** it: a lens whose invariant fails on a known-correct run is rejected rather than rendered. |
| `diff.ts` | Divergence Point. Walks two traces until their observable state stops matching. |
| `counterexample.ts` | Searches inputs for one that makes two implementations disagree, preferring the smallest. |
| `complexity.ts` | Fits measured operation counts to growth families in log space. |

### Trace and lens, kept apart

The **trace** is what happened. The **lens** is what it means.

```ts
// trace step (excerpt)
{ step: 17, line: 8, vars: { low: 6, high: 8, mid: 7 },
  event: { type: 'compare', op: '<', result: false },
  counters: { comparisons: 3, reads: 3, writes: 5 } }

// lens (static, per algorithm)
{ primary: 'arr',
  pointers: [{ var: 'low', on: 'arr', role: 'window-start', label: 'low' }],
  regions:  [{ on: 'arr', kind: 'eliminated', from: 0, to: 'low - 1' }],
  invariant: {
    text:  'If the target is in the array, its index is inside [low, high].',
    check: 'answer === -1 || (answer >= low && answer <= high)',
    when:  'defined(low) && defined(high)',
  } }
```

Range endpoints and invariants are **expression strings, not closures**, so a lens stays serialisable. That matters because the long-term goal is to infer one for code we have never seen — and an inferred lens can then be checked against a real run before it is allowed to draw anything.

Three channels are kept strictly separate and labelled as such in the UI:

- **vars** — real program state.
- **derived** — values the instrumentation computed so an invariant is checkable (`maxActive`, `reversedLen`). Never shown as program state.
- **oracle** — facts the checker knows but the program does not, such as the index the target actually sits at.

### `src/lib/algorithms/` — content

Each algorithm is one file exporting an `AlgorithmDef`: the displayed source, the lens, the instrumented `run`, buggy `variants`, `edgeCases`, `checkpoints`, and the inputs used for growth measurement.

## Adding an algorithm

1. Write the C++ listing you want shown. **Line numbers are the contract** — every `t.step(line, …)` must point at a real line.
2. Write `run(input, t)`, calling `t.step()` after each meaningful statement with the variables in scope and a sentence of narration. Attach an `ev.*` event where a real operation happened; counters derive from those.
3. Write the lens: which structure owns the stage, which variables are pointers, which ranges are regions, and — the part worth the most thought — the loop invariant.
4. Add at least one buggy variant with an authored explanation. The explanation is revealed only *after* divergence has been located.
5. Register it in `src/lib/algorithms/index.ts` and run `npm run smoke`. It will tell you if the invariant is wrong, the lines don't line up, or a variant is unreachable.

Narration may be a `() => string` thunk. Use that inside hot loops so `count` mode does not pay to build strings it discards.

---

## Product decisions worth knowing

Several things are deliberately **not** built:

- **No inferred complexity.** Static Big-O inference of arbitrary code is unreliable, and a confidently wrong answer destroys the trust an educational tool runs on. Growth is measured by re-running and counting.
- **No AI-generated animation.** The model never touches visual state. Numbers in its answers are checked against the payload it was given, and anything unaccounted for is reported to the reader as unverified rather than shown as fact.
- **No automatic optimisation engine.** Detecting which rung of an approach ladder you are on is tractable; inventing the next rung is not.
- **Autoplay is demoted.** Manual stepping is the default, because a play button recreates exactly the passivity that makes video a poor way to learn this.
- **Predict-then-reveal** stops at a handful of steps that carry the concept and asks what happens next before showing you. It is the one thing a video structurally cannot do.

## Roadmap

- More of the subset the interpreter refuses: strings are read-only, there are no pointers to
  locals, and templates are parsed but not modelled. Each of those is a refusal with a message
  today, which is the right failure — but the list should get shorter.
- Lens inference for unseen code: heuristics, then structural matching, then a model-proposed lens —
  always validated against a real run before it renders, with graceful fallback to the plain
  variable view.
- Approach ladders for the graph and DP families, which need a second implementation of each
  problem rather than any new machinery.

---

## Licence

MIT. See [LICENSE](LICENSE).
