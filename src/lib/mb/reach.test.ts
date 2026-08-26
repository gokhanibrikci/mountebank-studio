/**
 * Which address means which instance.
 *
 * `resolveTarget` decides how a request is sent, and the same comparison decides whether
 * this browser already has an instance in its list. Both readings turn on one question:
 * are these two strings the same Mountebank? The cases below are the ones people actually
 * type — the address from their terminal, the one with a trailing slash, `localhost`
 * where the host published `127.0.0.1`.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { isForwarded, resolveTarget, useReach } from './reach';

describe('resolveTarget', () => {
  beforeEach(() => {
    useReach.setState({ manifest: { local: 'http://127.0.0.1:2525' } });
  });

  it('routes the exact address the host publishes', () => {
    expect(resolveTarget('http://127.0.0.1:2525')).toBe('/mb/local');
  });

  it('routes localhost to the same instance as 127.0.0.1', () => {
    /* The banner says 127.0.0.1 and people type localhost. Reading those as two
       instances is what offered somebody a second row for the one they had. */
    expect(resolveTarget('http://localhost:2525')).toBe('/mb/local');
    expect(resolveTarget('http://LOCALHOST:2525/')).toBe('/mb/local');
  });

  it('routes the IPv6 loopback there too', () => {
    expect(resolveTarget('http://[::1]:2525')).toBe('/mb/local');
  });

  it('leaves a path that is already forwarded alone', () => {
    expect(resolveTarget('/mb/local')).toBe('/mb/local');
    expect(isForwarded('/mb/local')).toBe(true);
  });

  it('keeps a different port to itself, since that is a different instance', () => {
    expect(resolveTarget('http://127.0.0.1:2526')).toBe('http://127.0.0.1:2526');
    expect(isForwarded('http://127.0.0.1:2526')).toBe(false);
  });

  it('keeps a different scheme to itself', () => {
    expect(resolveTarget('https://127.0.0.1:2525')).toBe('https://127.0.0.1:2525');
  });

  it('does not confuse a remote host with this machine', () => {
    useReach.setState({ manifest: { stg: 'https://mountebank.example.com' } });
    expect(resolveTarget('http://localhost:2525')).toBe('http://localhost:2525');
    expect(resolveTarget('https://mountebank.example.com/')).toBe('/mb/stg');
  });

  it('calls the address directly when nothing is forwarded', () => {
    useReach.setState({ manifest: null });
    expect(resolveTarget('http://127.0.0.1:2525')).toBe('http://127.0.0.1:2525');
  });
});
