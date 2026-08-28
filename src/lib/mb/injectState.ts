/**
 * Keeping `config.state` on disk.
 *
 * Mountebank holds an imposter's state in memory and offers nothing to read or write it
 * from outside — no endpoint, nothing in `GET /imposters`. So this panel cannot save it,
 * and neither can the server. What CAN save it is the injected function itself: it runs
 * inside mountebank's process with a real `require`, so it can read and write a file.
 *
 * That is what this does. The function somebody writes is wrapped in a few lines that load
 * the file into `config.state` before it runs and write it back after. The wrapper is
 * marked, so the panel can show the original again rather than making somebody edit around
 * its own plumbing.
 *
 * WHAT THE WRAPPER HAS TO GET RIGHT, from mountebank's `responseResolver.js`:
 *
 *   • it is called as `(fn)(config, injectState, logger, done, imposterState)` — every
 *     argument is passed through, because a function written for the older interface uses
 *     the positional ones;
 *   • a DEFINED return value is the response, and that is the common case;
 *   • an UNDEFINED return means the answer comes later through `config.callback` (which is
 *     the same function as the fourth argument), so the save has to happen there instead —
 *     both are replaced with one that saves first;
 *   • `config.state` IS the imposter's state object, not a copy, so writing keys onto it
 *     is what mountebank will keep in memory.
 *
 * Every file operation is wrapped in try/catch. A mock that stops answering because a
 * directory is read-only would be a worse failure than state that did not persist.
 */

const OPEN = '/*<mbs-user>*/';
const CLOSE = '/*</mbs-user>*/';

/** Whether this injected function is one the panel wrapped. */
export const isStateKept = (fn: string): boolean => fn.includes(OPEN) && fn.includes(CLOSE);

/** The function somebody actually wrote, with the plumbing taken off. */
export function unwrapState(fn: string): string {
  if (!isStateKept(fn)) return fn;
  const start = fn.indexOf(OPEN) + OPEN.length;
  const end = fn.lastIndexOf(CLOSE);
  return end > start ? fn.slice(start, end).trim() : fn;
}

/** Where a wrapped function keeps it, or null when it is not wrapped. */
export function stateFileOf(fn: string): string | null {
  const match = /__mbsFile\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/.exec(fn);
  if (match === null) return null;
  try {
    return JSON.parse(`"${(match[1] ?? match[2] ?? '').replace(/"/g, '\\"')}"`);
  } catch {
    return match[1] ?? match[2] ?? null;
  }
}

/**
 * Wrap a function so its `config.state` survives a restart.
 *
 * Wrapping an already-wrapped function replaces the wrapper rather than nesting it, so
 * turning the switch off and on again does not build up layers.
 */
export function wrapWithState(fn: string, file: string): string {
  const inner = unwrapState(fn).trim();
  const path = JSON.stringify(file);
  return `function (config, injectState, logger, done, imposterState) {
  /* Written by Mountebank Studio: config.state is kept in a file so it survives a restart.
     Edit the function below; this wrapper is not part of it. */
  var __mbsFs = require('fs');
  var __mbsFile = ${path};
  try {
    var __mbsSaved = JSON.parse(__mbsFs.readFileSync(__mbsFile, 'utf8'));
    for (var __mbsKey in __mbsSaved) { config.state[__mbsKey] = __mbsSaved[__mbsKey]; }
  } catch (__mbsError) { /* no file yet, or unreadable: start from what is in memory */ }
  var __mbsSave = function () {
    try { __mbsFs.writeFileSync(__mbsFile, JSON.stringify(config.state, null, 2)); }
    catch (__mbsError) { /* a mock that still answers beats one that dies over a write */ }
  };
  var __mbsDone = function (__mbsResponse) {
    __mbsSave();
    return typeof done === 'function' ? done(__mbsResponse) : __mbsResponse;
  };
  config.callback = __mbsDone;
  var __mbsOut = (${OPEN}${inner}${CLOSE}).apply(this, [config, injectState, logger, __mbsDone, imposterState]);
  if (typeof __mbsOut !== 'undefined') { __mbsSave(); }
  return __mbsOut;
}`;
}
