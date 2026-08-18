import type { ReactNode } from 'react';

import styles from './Chips.module.css';

export type PillTone = 'neutral' | 'ok' | 'warn' | 'err' | 'acc';

export interface PillProps {
  tone?: PillTone;
  /** Leading status dot, inheriting the pill's own colour. */
  dot?: boolean;
  children: ReactNode;
}

const PILL_TONE: Record<PillTone, string | undefined> = {
  neutral: '',
  ok: styles.ok,
  warn: styles.warn,
  err: styles.err,
  acc: styles.acc,
};

export function Pill({ tone = 'neutral', dot = false, children }: PillProps) {
  return (
    <span
      className={[styles.pill, PILL_TONE[tone]].filter((c): c is string => Boolean(c)).join(' ')}
    >
      {dot ? <span className={styles.dot} /> : null}
      {children}
    </span>
  );
}

const VERB_TONE: Record<string, string | undefined> = {
  GET: styles.get,
  POST: styles.post,
  PUT: styles.put,
  PATCH: styles.patch,
  DELETE: styles.del,
  ANY: styles.any,
};

export interface VerbProps {
  method: string;
}

/** Coloured HTTP verb chip. Unknown verbs fall back to the neutral ground. */
export function Verb({ method }: VerbProps) {
  const m = method.toUpperCase();
  return (
    <span className={[styles.verb, VERB_TONE[m]].filter((c): c is string => Boolean(c)).join(' ')}>
      {m}
    </span>
  );
}

export interface OffProps {
  children: ReactNode;
}

/**
 * A value that sits outside its target: terracotta ink plus a trailing warning
 * glyph, added by CSS so the text itself stays copyable.
 */
export function Off({ children }: OffProps) {
  return <span className={styles.off}>{children}</span>;
}
