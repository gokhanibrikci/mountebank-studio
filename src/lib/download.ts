/**
 * Handing the browser a file.
 *
 * Kept apart from whatever builds the content — `postman.ts` returns an object and knows
 * nothing about the DOM, so its awkward parts stay unit-testable — and apart from the
 * screens, so a second export cannot invent a second way of doing this.
 */

/** Save `value` as pretty-printed JSON under `filename`. */
export function saveJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  /* The blob is only needed for that click; keeping it would hold the whole document. */
  URL.revokeObjectURL(url);
}
