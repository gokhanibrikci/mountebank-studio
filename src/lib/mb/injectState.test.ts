/**
 * The wrapper that keeps `config.state` on disk.
 *
 * What matters is that the function somebody wrote comes back exactly as they wrote it —
 * the editor shows the unwrapped form, so a lossy round trip would quietly rewrite
 * somebody's code — and that the wrapper honours mountebank's calling convention, which
 * is `(config, injectState, logger, done, imposterState)` with the answer coming either
 * from the return value or from `config.callback`.
 */

import { describe, expect, it } from 'vitest';

import { isStateKept, stateFileOf, unwrapState, wrapWithState } from './injectState';

const user =
  "function (config) { config.state.n = (config.state.n || 0) + 1; return { body: String(config.state.n) }; }";
const FILE = '/home/someone/.mountebank-studio/local-2525.state.json';

describe('wrapWithState', () => {
  it('gives back the original, character for character', () => {
    expect(unwrapState(wrapWithState(user, FILE))).toBe(user);
  });

  it('marks itself, so the panel knows which form it is looking at', () => {
    expect(isStateKept(user)).toBe(false);
    expect(isStateKept(wrapWithState(user, FILE))).toBe(true);
  });

  it('reports the file it writes to', () => {
    expect(stateFileOf(wrapWithState(user, FILE))).toBe(FILE);
    expect(stateFileOf(user)).toBeNull();
  });

  it('replaces its own wrapper rather than nesting one inside another', () => {
    const once = wrapWithState(user, '/a.json');
    const twice = wrapWithState(once, '/b.json');
    expect(stateFileOf(twice)).toBe('/b.json');
    expect(unwrapState(twice)).toBe(user);
    expect(twice.split('mbs-user').length).toBe(3);
  });

  it('leaves an unwrapped function alone when asked to unwrap it', () => {
    expect(unwrapState(user)).toBe(user);
  });

  it('escapes the path rather than pasting it into source', () => {
    const wrapped = wrapWithState(user, '/tmp/it\'s "quoted"/state.json');
    /* It has to remain valid JavaScript, which is the whole point of quoting it. */
    expect(() => new Function(`return (${wrapped})`)).not.toThrow();
  });
});

describe('the wrapped function, actually run', () => {
  /**
   * A stand-in for mountebank: it calls
   * `(fn)(config, injectState, logger, done, imposterState)` and takes the answer from the
   * return value, or from `config.callback` when that is undefined.
   */
  const runner = (
    source: string,
    files: Record<string, string>,
  ): ((body?: unknown) => unknown) => {
    const fs = {
      readFileSync: (path: string): string => {
        const found = files[path];
        if (found === undefined) throw new Error('ENOENT');
        return found;
      },
      writeFileSync: (path: string, data: string): void => {
        files[path] = data;
      },
    };
    const require = (name: string): unknown => {
      if (name === 'fs') return fs;
      throw new Error(`no module ${name}`);
    };
    const fn = new Function('require', `return (${source})`)(require) as (
      ...args: unknown[]
    ) => unknown;
    const state: Record<string, unknown> = {};
    return () => {
      let answer: unknown;
      const done = (r: unknown): unknown => (answer = r);
      const config = { request: {}, state, callback: done };
      const out = fn(config, {}, { debug: () => {} }, done, state);
      return out === undefined ? answer : out;
    };
  };

  it('loads the file before the function runs and writes it back after', () => {
    const files: Record<string, string> = { [FILE]: JSON.stringify({ n: 41 }) };
    const call = runner(wrapWithState(user, FILE), files);
    expect(call()).toEqual({ body: '42' });
    expect(JSON.parse(files[FILE] ?? '{}')).toEqual({ n: 42 });
  });

  it('starts from nothing when there is no file yet, without failing the request', () => {
    const files: Record<string, string> = {};
    const call = runner(wrapWithState(user, FILE), files);
    expect(call()).toEqual({ body: '1' });
    expect(JSON.parse(files[FILE] ?? '{}')).toEqual({ n: 1 });
  });

  it('survives an unreadable file rather than breaking the mock', () => {
    const files: Record<string, string> = { [FILE]: 'not json at all' };
    expect(runner(wrapWithState(user, FILE), files)()).toEqual({ body: '1' });
  });

  it('saves for a function that answers through config.callback', () => {
    /* mountebank's async form: return nothing, call the callback later. */
    const async =
      'function (config) { config.state.hits = (config.state.hits || 0) + 1; config.callback({ body: "async" }); }';
    const files: Record<string, string> = {};
    expect(runner(wrapWithState(async, FILE), files)()).toEqual({ body: 'async' });
    expect(JSON.parse(files[FILE] ?? '{}')).toEqual({ hits: 1 });
  });

  it('saves for a function that answers through the fourth argument', () => {
    /* The older interface, which is why every argument is passed through. */
    const old = 'function (config, injectState, logger, done) { done({ body: "old" }); }';
    const files: Record<string, string> = {};
    expect(runner(wrapWithState(old, FILE), files)()).toEqual({ body: 'old' });
  });
});
