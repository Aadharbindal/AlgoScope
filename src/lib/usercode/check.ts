import { AlgorithmDef, buildTrace, Input, UserLane, UserLang } from '../algorithms/types';
import { candidateInputs } from '../trace/counterexample';
import { runUserIn } from './dispatch';

/**
 * Does the reader's code agree with the reference?
 *
 * The same idea as the Bug Lab's counterexample search, pointed at code we did
 * not write. Step-by-step trace diffing is meaningless here — two correct
 * implementations of binary search take different steps — so the comparison is
 * on the answer, over many inputs, reporting the smallest one that disagrees.
 */

export interface UserVerdict {
  /** Inputs tried before giving a verdict. */
  tried: number;
  /** null when nothing disagreed. Not a proof of correctness, and we say so. */
  counterexample: {
    input: Input;
    label: string;
    yours: string;
    correct: string;
  } | null;
  /** Set when the code failed to run at all on some input. */
  error?: { message: string; label: string };
}

const size = (i: Input) => i.array?.length ?? 0;

export function checkUserCode(
  def: AlgorithmDef,
  source: string,
  lane: UserLane,
  lang: UserLang = 'js',
  budget = 200,
): UserVerdict {
  const candidates = candidateInputs(def);
  let tried = 0;
  let smallest: UserVerdict['counterexample'] = null;

  for (const candidate of candidates) {
    if (tried >= budget) break;
    // Inputs the algorithm is not defined on prove nothing about the reader's
    // code, so they are not counted as tried either.
    if (lane.precondition && !lane.precondition(candidate.input)) continue;
    tried++;

    const mine = runUserIn(def, source, lang, candidate.input, lane);
    if (!mine.ok) {
      return { tried, counterexample: null, error: { message: mine.message, label: candidate.label } };
    }

    const correct = String(buildTrace(def, candidate.input).result);
    if (mine.normalised === correct) continue;

    const found = {
      input: candidate.input,
      label: candidate.label,
      yours: mine.normalised,
      correct,
    };
    // The default input is the one already on screen, so if it disagrees that
    // is the most useful thing to show.
    if (candidate.source === 'default') return { tried, counterexample: found };
    if (!smallest || size(candidate.input) < size(smallest.input)) smallest = found;
  }

  return { tried, counterexample: smallest };
}
