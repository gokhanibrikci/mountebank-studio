/**
 * A bulk write that turns out to be half a write is the worst thing this feature could do,
 * so the parser's job is to know before anything is sent. These tests are about the cases
 * where a file is nearly right: the shape people actually paste, a port that is not a port,
 * two imposters on one port, a protocol that looks like a typo.
 */

import { describe, expect, it } from 'vitest';

import { countStubs, parseImposterJson, portsInUse } from './importConfig';
import type { MbImposter } from './mb/types';

const orders = { port: 4545, protocol: 'http', name: 'orders', stubs: [{ responses: [] }] };
const billing = { port: 4546, protocol: 'http', name: 'billing', stubs: [] };

describe('parseImposterJson', () => {
  it('reads the document mountebank itself writes', () => {
    const out = parseImposterJson(JSON.stringify({ imposters: [orders, billing] }));
    expect(out.shape).toBe('configfile');
    expect(out.imposters.map((i) => i.port)).toEqual([4545, 4546]);
    expect(out.problems).toEqual([]);
  });

  it('reads a bare array, which is what most exports paste as', () => {
    const out = parseImposterJson(JSON.stringify([orders]));
    expect(out.shape).toBe('array');
    expect(out.imposters).toHaveLength(1);
  });

  it('reads one imposter on its own', () => {
    const out = parseImposterJson(JSON.stringify(orders));
    expect(out.shape).toBe('single');
    expect(out.imposters[0]?.name).toBe('orders');
  });

  it('keeps whitespace and formatting out of it', () => {
    const out = parseImposterJson(`\n\n  ${JSON.stringify({ imposters: [orders] })}  \n`);
    expect(out.imposters).toHaveLength(1);
  });

  it('reports unparseable JSON as a problem rather than throwing', () => {
    const out = parseImposterJson('{ "imposters": [ }');
    expect(out.imposters).toEqual([]);
    expect(out.problems[0]?.what).toContain('is not JSON');
  });

  it('reports an empty file', () => {
    expect(parseImposterJson('   ').problems[0]?.what).toBe('is empty');
  });

  it('refuses an imposter with no protocol, and says what mountebank wants', () => {
    const out = parseImposterJson(JSON.stringify({ imposters: [{ port: 4545 }] }));
    expect(out.imposters).toEqual([]);
    expect(out.problems[0]?.what).toContain('no protocol');
    expect(out.problems[0]?.where).toBe('imposter 1 of 1');
  });

  it('refuses a port that is not a port', () => {
    for (const port of ['4545', 0, 70000, 4545.5]) {
      const out = parseImposterJson(JSON.stringify([{ port, protocol: 'http' }]));
      expect(out.imposters).toEqual([]);
      expect(out.problems[0]?.what).toContain('not a whole number');
    }
  });

  it('allows a missing port, because mountebank assigns one', () => {
    const out = parseImposterJson(JSON.stringify([{ protocol: 'http', stubs: [] }]));
    expect(out.imposters).toHaveLength(1);
    expect(out.problems).toEqual([]);
  });

  it('keeps an unknown protocol but flags it, since a typo looks the same', () => {
    const out = parseImposterJson(JSON.stringify([{ port: 4545, protocol: 'htpp' }]));
    expect(out.imposters).toHaveLength(1);
    expect(out.problems[0]?.what).toContain('not one of mountebank');
  });

  it('skips the second of two imposters on one port, naming the first', () => {
    const out = parseImposterJson(JSON.stringify({ imposters: [orders, { ...billing, port: 4545 }] }));
    expect(out.imposters).toHaveLength(1);
    expect(out.problems[0]?.what).toContain('already used by imposter 1');
  });

  it('refuses stubs that are not a list', () => {
    const out = parseImposterJson(JSON.stringify([{ port: 4545, protocol: 'http', stubs: {} }]));
    expect(out.imposters).toEqual([]);
    expect(out.problems[0]?.what).toBe('stubs is not a list');
  });

  it('takes the good ones and reports the rest, rather than refusing the file', () => {
    const out = parseImposterJson(
      JSON.stringify({ imposters: [orders, { port: 'nope', protocol: 'http' }, billing] }),
    );
    expect(out.imposters.map((i) => i.port)).toEqual([4545, 4546]);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]?.where).toBe('imposter 2 of 3');
  });

  it('says nothing usable was found when a bare value is pasted', () => {
    expect(parseImposterJson('42').imposters).toEqual([]);
    expect(parseImposterJson('42').problems[0]?.what).toContain('bare value');
  });
});

describe('what the screen has to say before writing', () => {
  const existing = [{ port: 4545, protocol: 'http' }, { port: 9999, protocol: 'http' }] as MbImposter[];

  it('names the ports something is already listening on', () => {
    const out = parseImposterJson(JSON.stringify({ imposters: [orders, billing] }));
    expect(portsInUse(out.imposters, existing)).toEqual([4545]);
  });

  it('counts nothing as in use when the file brings new ports only', () => {
    const out = parseImposterJson(JSON.stringify([billing]));
    expect(portsInUse(out.imposters, existing)).toEqual([]);
  });

  it('counts the stubs, so the sentence can say how much is arriving', () => {
    const out = parseImposterJson(
      JSON.stringify({ imposters: [orders, { ...billing, stubs: [{}, {}] }] }),
    );
    expect(countStubs(out.imposters)).toBe(3);
  });
});
