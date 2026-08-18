import type { ReactNode } from 'react';

import styles from './Seg.module.css';

export interface SegOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegOption<T>[];
  /** `accent` fills the pressed segment with forest green, as the topbar does. */
  tone?: 'default' | 'accent' | 'warn';
  /** Group label for assistive tech, e.g. "Detail level". */
  label?: string;
}

/** Segmented control. The pressed segment is announced with aria-pressed. */
export function Seg<T extends string>({
  value,
  onChange,
  options,
  tone = 'default',
  label,
}: SegProps<T>) {
  return (
    <div
      className={[
        styles.seg,
        tone === 'accent' ? styles.acc : '',
        tone === 'warn' ? styles.warn : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="group"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={styles.btn}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
