/**
 * What a browser takes on from the host that served it.
 *
 * The rule these tests pin down replaced one that read "adopt only when the browser
 * has none of its own". That protected a user's edits and broke the ordinary case:
 * somebody who had used the panel before ran `npx mountebank-studio`, and the panel
 * opened on whatever they last had — for one person a staging instance this host
 * neither forwards nor can reach — while the instance the command had just started sat
 * unlisted. The second test here is that report.
 */

import { describe, expect, it } from 'vitest';

import { adoptable, validate, type MbEnvironment } from './environments';

const local: MbEnvironment = { id: 'local', label: 'Local', target: '/mb/local' };
const staging: MbEnvironment = {
  id: 'staging',
  label: 'Staging',
  target: 'https://mountebank.stg.example.com',
};

describe('adoptable', () => {
  it('gives a fresh browser what the host published', () => {
    expect(adoptable([], [local], [])).toEqual([local]);
  });

  it('adds it alongside environments the browser already had', () => {
    /* The bug: this returned nothing, so one command started an instance nobody saw. */
    expect(adoptable([staging], [local], [])).toEqual([local]);
  });

  it('does not hand back a published environment that was already offered', () => {
    /* Removing one is a decision. The next start must not argue with it. */
    const published: MbEnvironment = { id: 'corp', label: 'Corp', target: 'https://mb.corp.example' };
    expect(adoptable([staging], [published], ['corp'])).toEqual([]);
  });

  it('still lists the instance this page serves, offered or not', () => {
    /*
     * The exception to the rule above, and the report that made it one: a browser with
     * `local` in `offered` from an earlier version never got it back, so `mountebank-studio`
     * opened on something else while the instance it had just started sat unlisted — and
     * the only route back was typing an address this process publishes itself. It is not a
     * preference to remember; it is what the process is.
     */
    expect(adoptable([staging], [local], ['local'])).toEqual([local]);
  });

  it('does not add it twice when the list has it under the address from the terminal', () => {
    /*
     * The banner prints `http://127.0.0.1:2525` and the host publishes `/mb/local`. One
     * instance. Told how to resolve an address — which is what the app passes — the two
     * spellings are one row, and the exemption above cannot make a duplicate.
     */
    const typed: MbEnvironment = { id: 'mine', label: 'Mine', target: 'http://127.0.0.1:2525' };
    const resolve = (t: string): string => (t === 'http://127.0.0.1:2525' ? '/mb/local' : t);
    expect(adoptable([typed], [local], [], resolve)).toEqual([]);
    /* Without the resolver it cannot know, and says so by adopting. */
    expect(adoptable([typed], [local], [])).toEqual([local]);
  });

  it('leaves an id the browser is already using alone', () => {
    const mine: MbEnvironment = { id: 'local', label: 'Mine', target: 'http://localhost:9999' };
    expect(adoptable([mine], [local], [])).toEqual([]);
  });

  it('does not add a second row for an instance already reachable', () => {
    const same: MbEnvironment = { id: 'forwarded', label: 'Forwarded', target: '/mb/local' };
    expect(adoptable([same], [local], [])).toEqual([]);
  });

  it('compares targets without a trailing slash', () => {
    const slashed: MbEnvironment = { id: 'forwarded', label: 'Forwarded', target: '/mb/local/' };
    expect(adoptable([slashed], [local], [])).toEqual([]);
  });

  it('takes each of several published environments on its own merits', () => {
    const other: MbEnvironment = { id: 'other', label: 'Other', target: 'https://other.example' };
    expect(adoptable([staging], [local, other], ['other'])).toEqual([local]);
  });

  it('has nothing to do when the host publishes nothing', () => {
    expect(adoptable([staging], [], [])).toEqual([]);
  });
});

describe('validate, on the address that is this page', () => {
  /*
   * Reported as a crash: an environment pointing at the panel's own URL. Both are on
   * 127.0.0.1, both were printed by the same command, and this one answers — with
   * index.html, for every path, because a single-page app has to. So it looked alive and
   * read nothing. There is no jsdom here, so the page is stated outright.
   */
  const asPage = (origin: string, run: () => void): void => {
    const had = 'window' in globalThis;
    Object.defineProperty(globalThis, 'window', {
      value: { location: { origin } },
      configurable: true,
      writable: true,
    });
    try {
      run();
    } finally {
      if (!had) delete (globalThis as { window?: unknown }).window;
    }
  };

  it('refuses the panel it is being typed into', () => {
    asPage('http://127.0.0.1:5273', () => {
      const errors = validate({ label: 'Local', target: 'http://127.0.0.1:5273' }, []);
      expect(errors.target).toContain('this page, not a Mountebank');
      expect(validate({ label: 'Local', target: 'http://127.0.0.1:5273/' }, []).target).toBeDefined();
    });
  });

  it('accepts the port the instance is actually on', () => {
    asPage('http://127.0.0.1:5273', () => {
      expect(validate({ label: 'Local', target: 'http://127.0.0.1:2525' }, [])).toEqual({});
    });
  });

  it('accepts a path on this origin, which is how forwarding is addressed', () => {
    asPage('http://127.0.0.1:5273', () => {
      expect(validate({ label: 'Local', target: '/mb/local' }, [])).toEqual({});
    });
  });

  it('accepts an instance that happens to share this origin under a path', () => {
    /* A reverse proxy putting both behind one hostname is ordinary, and only the bare
       origin is the mistake being caught. */
    asPage('https://tools.example.com', () => {
      expect(validate({ label: 'Mb', target: 'https://tools.example.com/mb-admin' }, [])).toEqual({});
    });
  });
});
