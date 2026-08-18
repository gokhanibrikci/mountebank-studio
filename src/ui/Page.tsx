import type { ReactNode } from 'react';

import styles from './Page.module.css';

export interface PageHeadProps {
  /** Uppercase accent line above the title. Omitted on screens whose title says it all. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** One-paragraph plain-language explanation under the title. */
  sub?: ReactNode;
  /** Right-aligned facts, e.g. ports and admin API. */
  meta?: ReactNode;
  /** Right-aligned controls. Replaces `meta`'s slot when both are present. */
  tools?: ReactNode;
}

/** Eyebrow → title → recap, the reference layout's page opening. */
export function PageHead({ eyebrow, title, sub, meta, tools }: PageHeadProps) {
  return (
    <>
      {eyebrow !== undefined ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
      <div className={styles.head}>
        <div>
          <h1>{title}</h1>
          {sub !== undefined ? <p>{sub}</p> : null}
        </div>
        {meta !== undefined ? <div className={styles.meta}>{meta}</div> : null}
        {tools !== undefined ? (
          <>
            <div className={styles.spacer} />
            <div className={styles.tools}>{tools}</div>
          </>
        ) : null}
      </div>
    </>
  );
}

export interface SummaryProps {
  label: ReactNode;
  children: ReactNode;
}

/** The plain-language recap block that follows every page head. */
export function Summary({ label, children }: SummaryProps) {
  return (
    <div className={styles.summary}>
      <span className={styles.label}>{label}</span>
      <p>{children}</p>
    </div>
  );
}

export interface EmptyStateProps {
  title: ReactNode;
  children: ReactNode;
  /** The one thing to do next, usually a primary Button. */
  action?: ReactNode;
  /**
   * A wider measure for a body that is an explanation rather than a nudge. The
   * default 46ch is right for "No imposters yet"; a failure that names a cause and
   * carries a command turns into a narrow eight-line column at that width.
   */
  wide?: boolean;
}

export function EmptyState({ title, children, action, wide = false }: EmptyStateProps) {
  return (
    <div className={[styles.empty, wide ? styles.emptyWide : ''].filter(Boolean).join(' ')}>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
