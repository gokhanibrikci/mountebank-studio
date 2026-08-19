/**
 * The seed has a job beyond being valid: it has to read well.
 *
 * A first visit is decided by what the Overview says. Traffic that mostly fails to match
 * looks like a badly configured system rather than a demonstration — the first version of
 * this seed had three of seven requests unmatched and read as "these mocks are broken". One
 * unmatched request is the useful number: it shows that the panel notices, without
 * suggesting nothing works.
 *
 * So this asserts the story, using the panel's own matcher over the panel's own model. A
 * change to the seed that quietly breaks the demo fails here instead of on the internet.
 */

import { describe, expect, it } from 'vitest';

import { findMatchingStub } from '../mb/match';
import { imposterFromMb } from '../mb/model';
import { demoImposters } from './seed';

describe('the demo seed', () => {
  it('leaves exactly one request unanswered, and spreads the others over the stubs', () => {
    const hitsByImposter: Record<string, number[]> = {};
    let unmatched = 0;

    for (const wire of demoImposters()) {
      const imposter = imposterFromMb(wire);
      const hits = imposter.stubs.map(() => 0);

      for (const request of wire.requests ?? []) {
        const index = findMatchingStub(request, imposter.stubs);
        if (index === null) unmatched += 1;
        else hits[index] = (hits[index] ?? 0) + 1;
      }
      hitsByImposter[imposter.name] = hits;
    }

    expect(unmatched).toBe(1);

    /* orders: the exact stub once, the negated one once, the cycled one twice — so the
       Activity screen shows a response cycle actually cycling. */
    expect(hitsByImposter['orders-service']?.slice(0, 3)).toEqual([1, 1, 2]);
    /* payments: both requests answered by its first stub. */
    expect(hitsByImposter['payments-service']?.[0]).toBe(2);
  });

  it('carries every response kind, so no screen in the demo is empty', () => {
    const kinds = new Set<string>();
    for (const wire of demoImposters()) {
      for (const stub of wire.stubs ?? []) {
        for (const response of stub.responses ?? []) {
          for (const key of ['is', 'proxy', 'inject', 'fault']) {
            if (key in response) kinds.add(key);
          }
        }
      }
    }
    expect([...kinds].sort()).toEqual(['fault', 'inject', 'is', 'proxy']);
  });

  it('reads as traffic from minutes ago however long after the build it is opened', () => {
    const [first] = demoImposters();
    const newest = first?.requests?.at(-1)?.timestamp;
    expect(newest).toBeDefined();
    const ageMinutes = (Date.now() - Date.parse(newest ?? '')) / 60_000;
    expect(ageMinutes).toBeGreaterThanOrEqual(0);
    expect(ageMinutes).toBeLessThan(10);
  });
});
