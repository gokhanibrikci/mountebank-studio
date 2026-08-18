import type { ReactNode } from 'react';

import styles from './Strip.module.css';

export type StripTone = 'neutral' | 'info' | 'warn' | 'err';

export interface StripProps {
  tone?: StripTone;
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  /** A way out of the situation the strip is reporting, e.g. a Retry button. */
  actions?: ReactNode;
  /**
   * Drop the bottom margin, for a strip that sits inside a container which
   * already spaces its children — a Section body, say. Without it the strip's own
   * margin stacks on top of that gap.
   */
  flush?: boolean;
}

/**
 * A strip of context above a screen's content.
 *
 * `info` is the standing explanation of what a screen is for — always true, so it
 * never carries live numbers. `warn` and `err` describe the current state and are
 * the only tones that should draw the eye.
 */
export function Strip({
  tone = 'neutral',
  icon,
  title,
  children,
  actions,
  flush = false,
}: StripProps) {
  const toneClass =
    tone === 'info'
      ? styles.info
      : tone === 'warn'
        ? styles.warn
        : tone === 'err'
          ? styles.err
          : '';

  return (
    <div className={[styles.strip, toneClass, flush ? styles.flush : ''].filter(Boolean).join(' ')}>
      {icon}
      <div className={styles.body}>
        <b>{title}</b>
        <p>{children}</p>
      </div>
      {actions !== undefined ? <div className={styles.acts}>{actions}</div> : null}
    </div>
  );
}
