/**
 * The stub list: one card per stub, in match order.
 *
 * Order is load-bearing — mountebank answers with the FIRST stub whose
 * predicates all pass — so the ordinal gutter and the two reorder buttons are
 * part of the card itself rather than a menu somewhere else. The reorder buttons
 * stop the click from reaching the card, because moving a stub and opening it
 * are different intentions.
 *
 * The ledger reads out `summaries.ts`, which returns plain strings. They are
 * tokenised here for colour only: operators in --acc, literals in --tx. No
 * meaning is added that the string did not already carry.
 */

import type { KeyboardEvent, ReactNode } from 'react';

import { type EnvId } from '../lib/environments';
import { plural } from '../lib/format';
import { useInstanceFacts } from '../lib/mb/instanceFacts';
import { hasUnevaluablePredicate } from '../lib/mb/match';
import type { Stub } from '../lib/mb/types';
import { RTYPE, respTone, respondOf, sigOf, whenOf, type RespTone } from '../lib/summaries';
import { Button, EmptyState, Icon, Pill, Verb } from '../ui';
import type { PillTone } from '../ui';
import styles from './StubList.module.css';

/* ─────────────────────────────  ledger colouring  ──────────────────────── */

/** Whole-phrase readings from `whenOf`/`respondOf` that are prose, not a rule. */
const PROSE = new Set([
  'every request — no conditions set',
  'any request matching the path',
  'custom predicate',
  'no response',
]);

/**
 * Operators and JSON literals, in that order of precedence: a quoted string is
 * matched first so the word `contains` inside a value is never mistaken for the
 * operator.
 */
const WHEN_RE =
  /(?<lit>"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)|(?<op>\bdoes not exist\b|\bexists\b|\bcontains\b|\bstarts\b|\bends\b|\bAND\b|\bOR\b|\bNOT\b|==|≡|~)/g;

/** The joiners `respondOf` uses between several responses. */
const RESPOND_RE = /(?<em>\bthen\b|\(cycles\)|·)/g;

type Ink = 'op' | 'lit' | 'em';

const INK_NAMES: Ink[] = ['op', 'lit', 'em'];

const INK: Record<Ink, string> = { op: styles.op, lit: styles.lit, em: styles.em };

/** Splits one ledger line into plain runs and coloured runs. */
function paint(text: string, re: RegExp): ReactNode {
  if (PROSE.has(text)) return <em className={styles.em}>{text}</em>;

  const out: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(re)) {
    const at = match.index ?? 0;
    const run = match[0];
    const groups: Record<string, string | undefined> = match.groups ?? {};
    const ink = INK_NAMES.find((name) => groups[name] !== undefined);

    if (at > last) out.push(text.slice(last, at));
    if (ink === undefined) out.push(run);
    // the offset is unique within the line, so it is the key
    else
      out.push(
        <span key={`${ink}-${at}`} className={INK[ink]}>
          {run}
        </span>,
      );

    last = at + run.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ────────────────────────────────  the list  ───────────────────────────── */

export interface StubListProps {
  /** Whose instance these stubs are on — the hit note quotes its flags. */
  env: EnvId;
  stubs: Stub[];
  /**
   * Hit count per stub index, computed from the captured request log —
   * mountebank does not report it (see match.ts). Shorter than `stubs` is fine;
   * a missing entry reads as zero.
   */
  hits: number[];
  /** Opens the stub editor for the stub at this index. */
  onOpen: (index: number) => void;
  /** Moves the stub one place earlier (-1) or later (+1). */
  onMove: (index: number, direction: -1 | 1) => void;

  /** Shown where the New stub button would be when the environment is read-only. */
  /** A write is in flight — reordering waits for it rather than racing it. */
  busy?: boolean;
}

/** `respTone` returns '' for "no opinion"; the pill calls that neutral. */
const pillTone = (tone: RespTone): PillTone => (tone === '' ? 'neutral' : tone);

export function StubList({
  env,
  stubs,
  hits,
  onOpen,
  onMove,
  busy = false,
}: StubListProps) {
  /* The hit tooltip claims what mountebank does and does not report, which turns on
     --debug — so it has to be read from the instance. */
  const facts = useInstanceFacts(env);

  if (!stubs.length) {
    return (
      <EmptyState
        title="No stubs on this imposter"
        action={<span className={styles.note}>Use New Stub above to add the first one.</span>}
      >
        A stub answers a request. First say <em>when</em> it applies with predicates, then say what
        to <em>respond</em>.
      </EmptyState>
    );
  }

  return (
    <>
      <div className={styles.head}>
        <span className="lbl">Matched top to bottom</span>
        <div className={styles.spacer} />
      </div>

      <div className={styles.list}>
        {stubs.map((stub, index) => {
          const sig = sigOf(stub);
          const tone = respTone(stub);
          const first = stub.responses[0];
          const computedHits = hits[index] ?? 0;
          const unevaluable = hasUnevaluablePredicate(stub);

          const open = () => onOpen(index);
          const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
            if (e.target !== e.currentTarget) return;
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            open();
          };

          return (
            <div
              key={stub.id}
              className={styles.stub}
              role="button"
              tabIndex={0}
              aria-label={`Stub ${index + 1}: ${sig.method} ${sig.path}`}
              onClick={open}
              onKeyDown={onKeyDown}
            >
              <div className={styles.ord} aria-hidden="true">
                {index + 1}
              </div>

              <div className={styles.main}>
                <div className={styles.sig}>
                  <Verb method={sig.method} />
                  <span className={styles.path} title={sig.path}>
                    {sig.path}
                  </span>
                </div>
                <div className={styles.ledger}>
                  <span className="lbl">When</span>
                  <span className={styles.value}>{paint(whenOf(stub), WHEN_RE)}</span>
                  <span className="lbl">Respond</span>
                  <span className={styles.value}>{paint(respondOf(stub), RESPOND_RE)}</span>
                </div>
              </div>

              <div className={styles.aside}>
                <Pill tone={pillTone(tone)}>
                  {stub.responses.length > 1
                    ? plural(stub.responses.length, 'response')
                    : first !== undefined
                      ? RTYPE[first.type]
                      : 'none'}
                </Pill>
                <div className={styles.acts}>
                  <span
                    className={styles.hits}
                    title={
                      unevaluable
                        ? 'Computed from the captured requests. This stub has a predicate the panel cannot evaluate, so the count may be low.'
                        : facts.reportsMatches
                          ? 'Computed from the captured requests. This instance runs with --debug, so mountebank recorded the matches itself, but the panel does not read that yet.'
                          : 'Computed from the captured requests — this instance does not run with --debug, so mountebank does not report per-stub hits.'
                    }
                  >
                    {unevaluable ? `${plural(computedHits, 'hit')}?` : plural(computedHits, 'hit')}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    icon={<Icon name="up" />}
                    title="Match this earlier"
                    aria-label={`Move stub ${index + 1} earlier`}
                    disabled={index === 0 || busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMove(index, -1);
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    icon={<Icon name="down" />}
                    title="Match this later"
                    aria-label={`Move stub ${index + 1} later`}
                    disabled={index === stubs.length - 1 || busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMove(index, 1);
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default StubList;
