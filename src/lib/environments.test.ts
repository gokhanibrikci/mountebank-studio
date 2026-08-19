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

import { adoptable, type MbEnvironment } from './environments';

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

  it('does not hand back an environment that was already offered', () => {
    /* Removing one is a decision. The next start must not argue with it. */
    expect(adoptable([staging], [local], ['local'])).toEqual([]);
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
    const other: MbEnvironment = { id: 'other', label: 'Other', target: '/mb/other' };
    expect(adoptable([staging], [local, other], ['other'])).toEqual([local]);
  });

  it('has nothing to do when the host publishes nothing', () => {
    expect(adoptable([staging], [], [])).toEqual([]);
  });
});
