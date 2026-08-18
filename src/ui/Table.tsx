import type { ReactNode } from 'react';

import styles from './Table.module.css';

export interface TableProps {
  /** The header row(s): `<tr><th>…</th></tr>`. */
  head: ReactNode;
  /** The body rows. */
  children: ReactNode;
}

/**
 * `.tbl` inside its own horizontal scroller, so a wide table never makes the
 * page scroll sideways.
 *
 * Cells use the prototype's global helper classes, which Table.module.css
 * styles under its own scope: `click` on a clickable row, `cell-sub` for a
 * secondary line, `cell-clip` to ellipsise, `row-acts` for the trailing action
 * cluster, `imp-name` for the status-pill-plus-name pair.
 */
export function Table({ head, children }: TableProps) {
  return (
    <div className={styles.scroll}>
      <table className={styles.tbl}>
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
