import type { ReactNode } from 'react';

import styles from './Panels.module.css';

export interface CardProps {
  title?: ReactNode;
  /** Right-aligned header controls, e.g. a "Manage →" button. */
  actions?: ReactNode;
  /**
   * Drop the body padding, for a Card whose whole content is a Table —
   * the shape the prototype uses on every list screen.
   */
  flush?: boolean;
  children: ReactNode;
}

export function Card({ title, actions, flush = false, children }: CardProps) {
  const hasHead = title !== undefined || actions !== undefined;
  return (
    <div className={styles.card}>
      {hasHead ? (
        <div className={styles.cardHead}>
          {title !== undefined ? <h2>{title}</h2> : null}
          <div className={styles.spacer} />
          {actions}
        </div>
      ) : null}
      {flush ? children : <div className={styles.cardBody}>{children}</div>}
    </div>
  );
}

export interface SectionProps {
  title: ReactNode;
  /** Small label or pill next to the title, e.g. "Predicates". */
  badge?: ReactNode;
  /** Accent icon before the title. */
  icon?: ReactNode;
  /** Right-aligned header note, e.g. "All conditions must match". */
  tools?: ReactNode;
  children: ReactNode;
}

/** The `.sec` block: the editor's unit of grouping. */
export function Section({ title, badge, icon, tools, children }: SectionProps) {
  return (
    <div className={styles.sec}>
      <div className={styles.secHead}>
        {icon}
        <h3>{title}</h3>
        {badge}
        <div className={styles.spacer} />
        {tools}
      </div>
      <div className={styles.secBody}>{children}</div>
    </div>
  );
}
