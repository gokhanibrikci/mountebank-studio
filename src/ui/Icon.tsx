import styles from './Icon.module.css';

/**
 * The prototype's `P{}` path map, unchanged. Every icon is a single stroked
 * path on a 20×20 grid, so one <svg> shell serves them all.
 */
const PATHS = {
  dash: 'M3 3h7v7H3zM11 3h6v4h-6zM11 8h6v9h-6zM3 11h7v6H3z',
  imps: 'M10 2.5 17 6l-7 3.5L3 6zM3 10l7 3.5L17 10M3 13.5 10 17l7-3.5',
  reqs: 'M6 3v9M6 17l-3-3M6 17l3-3M14 17V8M14 3l3 3M14 3l-3 3',
  act: 'M2 10h3l2.5-6 3 12 2.5-6h5',
  cog: 'M10 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM16 10a6 6 0 0 0-.1-1l1.5-1.2-1.4-2.4-1.8.6a6 6 0 0 0-1.7-1L12.2 3H7.8l-.3 1.9a6 6 0 0 0-1.7 1l-1.8-.6L2.6 7.8 4.1 9a6 6 0 0 0 0 2l-1.5 1.2 1.4 2.4 1.8-.6a6 6 0 0 0 1.7 1L7.8 17h4.4l.3-1.9a6 6 0 0 0 1.7-1l1.8.6 1.4-2.4L15.9 11c.1-.3.1-.7.1-1Z',
  plus: 'M10 4v12M4 10h12',
  x: 'M5 5l10 10M15 5L5 15',
  copy: 'M7 7V4h9v9h-3M4 7h9v9H4z',
  trash: 'M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11',
  chev: 'M8 5l5 5-5 5',
  up: 'M10 15V5M5 10l5-5 5 5',
  down: 'M10 5v10M5 10l5 5 5-5',
  search: 'M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12ZM13.5 13.5 17 17',
  code: 'M7 6 3 10l4 4M13 6l4 4-4 4',
  bolt: 'M11 2 4 11h5l-1 7 7-9h-5l1-7Z',
  globe:
    'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM3 10h14M10 3c2 2.3 3 4.6 3 7s-1 4.7-3 7c-2-2.3-3-4.6-3-7s1-4.7 3-7Z',
  file: 'M5 3h6l4 4v10H5zM11 3v4h4',
  check: 'M4 10.5 8 14.5 16 6',
  alert: 'M10 3 2.5 16h15L10 3ZM10 8v4M10 14.2v.1',
  save: 'M4 4h9l3 3v9H4zM7 4v5h6V4M7 16v-4h6v4',
  drag: 'M8 6h.1M12 6h.1M8 10h.1M12 10h.1M8 14h.1M12 14h.1',
  clock: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM10 6v4l3 2',
  filter: 'M3 5h14l-5 6v5l-4-2v-3z',
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps {
  name: IconName;
  /**
   * Fallback size in px. Icon size is normally governed by the *context* —
   * `.btn svg`, `.nav svg` and friends set width/height in CSS, which wins over
   * these attributes — exactly as in the prototype.
   */
  size?: number;
}

export function Icon({ name, size = 16 }: IconProps) {
  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
