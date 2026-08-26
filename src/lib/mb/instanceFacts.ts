/**
 * Two flags on the instance that decide what the panel is allowed to claim.
 *
 * `--mock` and `--debug` change what mountebank KEEPS, and four screens were each
 * describing that from memory, differently, and mostly wrongly:
 *
 *   • Activity said "mountebank stores the requests an imposter received, but not the
 *     response it sent" — untrue under --debug, which records the response it sent and
 *     the real processing time in each stub's `matches`.
 *   • Settings' "Matched stub" row said "reported by mountebank" on a --debug instance —
 *     true of the API, false of this panel, which never reads `matches`.
 *   • Imposters' Recording column, ImposterDetail's warning strip and the Overview tile
 *     all read an imposter's own `recordRequests` and announced that nothing was being
 *     kept — while a --mock instance was keeping every request regardless.
 *
 * A sentence about an instance has to be read off that instance. This is the one place
 * that does it, so the screens cannot drift apart again.
 *
 * Both flags are absent from `GET /config` when off — configController deletes a falsy
 * `mock` — so `undefined` means "not on", and `known` is what separates that from "not
 * read yet". Nothing here ever asserts a flag is OFF on an instance the panel could not
 * read: an unread instance yields `known: false` and every caller falls back to language
 * that does not depend on the answer.
 */

import { useConfig } from '../queries';
import type { EnvId } from '../environments';

export interface InstanceFacts {
  /** The panel has an answer from `GET /config`. */
  known: boolean;
  /**
   * `--mock`. Every request is kept whatever an imposter's `recordRequests` says, so a
   * screen must not tell anyone their traffic is being dropped.
   */
  recordsEverything: boolean;
  /**
   * `--debug`. Mountebank attaches a `matches` array to each stub — the request, the
   * response it actually sent, and the processing time.
   *
   * The panel does not read it. That is a gap, not a secret: every screen that shows a
   * matched stub computes it by re-evaluating predicates, and on a --debug instance it is
   * therefore showing its own answer while the real one sat in the reply. So this is
   * reported as "mountebank recorded it, this panel does not read it" rather than as
   * "mountebank cannot tell you".
   */
  reportsMatches: boolean;
}

export function useInstanceFacts(env: EnvId): InstanceFacts {
  const config = useConfig(env);
  return {
    known: config.data !== undefined,
    recordsEverything: config.data?.options.mock === true,
    reportsMatches: config.data?.options.debug === true,
  };
}

/**
 * Why the matched stub on every screen is the panel's own answer.
 *
 * One sentence, three states, so Activity, the imposter's requests table, the stub list
 * and Settings cannot each invent their own version of it again.
 */
export function whyMatchIsComputed(facts: InstanceFacts): string {
  if (facts.reportsMatches) {
    return 'This instance runs with --debug, so mountebank recorded which stub answered and what it sent. This panel does not read that yet — the match shown here is computed by evaluating predicates the way mountebank does.';
  }
  if (!facts.known) {
    return 'The matched stub is computed by this panel, by evaluating predicates the way mountebank does.';
  }
  return 'Mountebank keeps neither the response it sent nor which stub answered unless it runs with --debug, and this instance does not. The match shown here is computed by this panel, by evaluating predicates the way mountebank does.';
}

/** The short form, for a tooltip or a table cell. */
export function matchSource(facts: InstanceFacts): string {
  return facts.reportsMatches
    ? 'Computed by this panel — mountebank also recorded the match, but the panel does not read it'
    : 'Computed by this panel — this instance does not run with --debug, so mountebank did not report the match';
}

/** Whether anything this imposter receives is kept, and why. */
export function keptFor(
  facts: InstanceFacts,
  recordRequests: boolean | undefined,
): { kept: boolean; because: string } {
  if (recordRequests === true) {
    return { kept: true, because: 'Record requests is on for this imposter.' };
  }
  if (facts.recordsEverything) {
    return {
      kept: true,
      because:
        'This instance runs with --mock, so what this imposter receives is kept even though its own Record requests is off.',
    };
  }
  return {
    kept: false,
    because: facts.known
      ? 'Record requests is off for this imposter, and this instance does not run with --mock, so nothing it receives is kept.'
      : 'Record requests is off for this imposter, so nothing it receives is kept unless the instance runs with --mock.',
  };
}
