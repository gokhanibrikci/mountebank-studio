/**
 * What `seed` does to a list that already exists.
 *
 * The host publishes one environment: the instance this process serves. Adopting it is
 * `adoptable`'s job and tested there. What is tested here is the other half — a row this
 * host published to an EARLIER version, which named the route `/mb/local` rather than the
 * instance's address. Left alone, one instance would read two ways depending on when
 * somebody first ran the command.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { useEnvironments } from './useEnvironments';
import type { MbEnvironment } from '../lib/environments';

/* What the panel passes in real life: the manifest says this origin forwards that
   instance, so both spellings resolve to the same road. */
const resolve = (target: string): string =>
  target === 'http://127.0.0.1:2525' || target === '/mb/local' ? '/mb/local' : target;

const published: MbEnvironment = { id: 'local', label: 'Local', target: 'http://127.0.0.1:2525' };
const rows = (): [string, string][] =>
  useEnvironments.getState().list.map((e) => [e.id, e.target]);

describe('dropOwnAddress', () => {
  /* No jsdom in this suite, so the page is stated outright. */
  const asPage = (origin: string, run: () => void): void => {
    const had = 'window' in globalThis;
    Object.defineProperty(globalThis, 'window', { value: { location: { origin } }, configurable: true, writable: true });
    try {
      run();
    } finally {
      if (!had) delete (globalThis as { window?: unknown }).window;
    }
  };

  beforeEach(() => {
    useEnvironments.setState({ list: [], offered: [] });
  });

  it('drops the row that names this page and says which it was', () => {
    asPage('http://127.0.0.1:5273', () => {
      useEnvironments.setState({
        list: [
          { id: 'default-local-mb', label: 'Default Local MB', target: 'http://127.0.0.1:5273' },
          { id: 'local', label: 'Local', target: 'http://127.0.0.1:2525' },
        ],
        offered: [],
      });
      const gone = useEnvironments.getState().dropOwnAddress();
      expect(gone.map((e) => e.label)).toEqual(['Default Local MB']);
      expect(rows()).toEqual([['local', 'http://127.0.0.1:2525']]);
    });
  });

  it('ignores a trailing slash, which is the same address', () => {
    asPage('http://127.0.0.1:5273', () => {
      useEnvironments.setState({ list: [{ id: 'a', label: 'A', target: 'http://127.0.0.1:5273/' }], offered: [] });
      expect(useEnvironments.getState().dropOwnAddress()).toHaveLength(1);
      expect(rows()).toEqual([]);
    });
  });

  it('keeps the instance, the path and an address under a path on this origin', () => {
    asPage('http://127.0.0.1:5273', () => {
      const keep: MbEnvironment[] = [
        { id: 'local', label: 'Local', target: 'http://127.0.0.1:2525' },
        { id: 'route', label: 'Route', target: '/mb/local' },
        { id: 'proxied', label: 'Behind a proxy', target: 'http://127.0.0.1:5273/mb-admin' },
        { id: 'stg', label: 'Staging', target: 'https://mb.example.com' },
      ];
      useEnvironments.setState({ list: keep, offered: [] });
      expect(useEnvironments.getState().dropOwnAddress()).toEqual([]);
      expect(useEnvironments.getState().list).toEqual(keep);
    });
  });

  it('does nothing when there is no page to compare with', () => {
    useEnvironments.setState({ list: [{ id: 'a', label: 'A', target: 'http://127.0.0.1:5273' }], offered: [] });
    expect(useEnvironments.getState().dropOwnAddress()).toEqual([]);
  });
});

describe('seed', () => {
  beforeEach(() => {
    useEnvironments.setState({ list: [], offered: [] });
  });

  it('adopts what the host publishes on a fresh browser', () => {
    expect(useEnvironments.getState().seed([published], resolve)).toBe(true);
    expect(rows()).toEqual([['local', 'http://127.0.0.1:2525']]);
  });

  it('rewrites the route an older version stored to the address it resolves to', () => {
    useEnvironments.setState({ list: [{ id: 'local', label: 'Local', target: '/mb/local' }], offered: ['local'] });
    useEnvironments.getState().seed([published], resolve);
    expect(rows()).toEqual([['local', 'http://127.0.0.1:2525']]);
  });

  it('leaves a row somebody pointed at a different instance alone', () => {
    /* Same id, different Mountebank: an edit, and theirs to keep. */
    useEnvironments.setState({ list: [{ id: 'local', label: 'Mine', target: 'http://127.0.0.1:9999' }], offered: [] });
    useEnvironments.getState().seed([published], resolve);
    expect(rows()).toEqual([['local', 'http://127.0.0.1:9999']]);
  });

  it('keeps a label somebody chose while the address moves', () => {
    useEnvironments.setState({ list: [{ id: 'local', label: 'Benim yerelim', target: '/mb/local' }], offered: [] });
    useEnvironments.getState().seed([published], resolve);
    expect(useEnvironments.getState().list[0]?.label).toBe('Benim yerelim');
  });

  it('touches nothing when the host publishes nothing', () => {
    useEnvironments.setState({ list: [{ id: 'a', label: 'A', target: 'http://a.example' }], offered: [] });
    expect(useEnvironments.getState().seed([], resolve)).toBe(false);
    expect(rows()).toEqual([['a', 'http://a.example']]);
  });

  it('remembers that it offered, so a removal is not argued with next time', () => {
    const other: MbEnvironment = { id: 'corp', label: 'Corp', target: 'https://mb.corp.example' };
    useEnvironments.getState().seed([other], resolve);
    useEnvironments.getState().remove('corp');
    expect(useEnvironments.getState().seed([other], resolve)).toBe(false);
    expect(rows()).toEqual([]);
  });
});
