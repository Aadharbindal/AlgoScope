import { AlgorithmDef, Input, UserLane, UserLang } from '../algorithms/types';
import { runUserCode, UserRun } from './run';
import { runCFamily } from './runC';

/**
 * Run the reader's code in whichever language they chose.
 *
 * The two lanes behind this are genuinely different machines, and the
 * difference is visible to the reader rather than hidden:
 *
 *   - **JavaScript** is instrumented and handed to the browser's own engine.
 *     Fast and complete, but it only sees statement boundaries, so comparison
 *     and read counts are not measured and must not be shown.
 *   - **C / C++ / Java** run on this site's interpreter. A narrower subset of
 *     the language, but every operation passes through it — so the counters
 *     are real, and `int` is 32 bits, which is what lets the classic
 *     `(low + high) / 2` overflow actually happen.
 *
 * The lane is passed whole rather than picked apart, because what the
 * parameters receive and how the answer is spelled are properties of the
 * problem, not of the language.
 */
export function runUserIn(
  def: AlgorithmDef,
  source: string,
  lang: UserLang,
  input: Input,
  lane: UserLane,
): UserRun {
  if (lang === 'js') return runUserCode(def, source, input, lane);
  return runCFamily(def, source, lang, input, lane);
}

/** Whether the counters beside a trace were measured or merely bounded. */
export const countersAreMeasured = (lang: UserLang) => lang !== 'js';
