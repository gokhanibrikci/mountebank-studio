/**
 * Display formatting — the small vocabulary the whole panel shares.
 *
 * Ported verbatim from the prototype so a number, a duration or a status name
 * reads the same wherever it appears. Nothing here touches the network or the
 * model; it is pure text.
 */

/* ────────────────────────────────  time  ───────────────────────────────── */

/**
 * Coarse "how long ago" for feeds and row meta. Deliberately low-resolution:
 * the exact second is available from `hhmm` when it matters.
 */
export function ago(ts: number): string {
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

/** Wall-clock time to the second, in the viewer's own locale. */
export const hhmm = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/* ───────────────────────────────  counting  ────────────────────────────── */

/**
 * "1 stub" / "2 stubs" / "1 query" / "3 queries".
 *
 * The consonant + `y` test is what makes "query" pluralise correctly while
 * leaving "day" alone, so the count and its noun never disagree in the UI.
 */
export const plural = (n: number, word: string): string =>
  `${n} ${n === 1 ? word : /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`}`;

/* ────────────────────────────  HTTP statuses  ──────────────────────────── */

/**
 * The status names the panel spells out. A code that is missing here is shown
 * as a bare number rather than guessed at — see `respondOf` in summaries.ts.
 */
export const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved',
  302: 'Found',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable',
  429: 'Too Many Requests',
  500: 'Server Error',
  502: 'Bad Gateway',
  503: 'Unavailable',
  504: 'Gateway Timeout',
};

/** Which semantic token a status code earns. '' means "no opinion". */
export type StatusTone = 'ok' | 'warn' | 'err' | '';

export function statusTone(code: number): StatusTone {
  if (code >= 500) return 'err';
  if (code >= 400) return 'warn';
  if (code >= 200 && code < 300) return 'ok';
  return '';
}
