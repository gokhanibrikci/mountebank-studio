/**
 * What the screens are allowed to say about an instance.
 *
 * Two flags — `--mock` and `--debug` — and one rule: nothing here asserts a flag is OFF on
 * an instance the panel could not read. Four screens each got this wrong in their own way
 * before it lived in one place, so the states are pinned down.
 */

import { describe, expect, it } from 'vitest';

import { keptFor, matchSource, whyMatchIsComputed, type InstanceFacts } from './instanceFacts';

const unread: InstanceFacts = { known: false, recordsEverything: false, reportsMatches: false };
const plain: InstanceFacts = { known: true, recordsEverything: false, reportsMatches: false };
const mock: InstanceFacts = { known: true, recordsEverything: true, reportsMatches: false };
const debug: InstanceFacts = { known: true, recordsEverything: false, reportsMatches: true };

describe('keptFor', () => {
  it('keeps what an imposter asked to keep', () => {
    expect(keptFor(plain, true)).toEqual({ kept: true, because: expect.stringContaining('on for this imposter') });
  });

  it('keeps everything on a --mock instance, whatever the imposter says', () => {
    /* The bug this exists for: four screens told people their traffic was being dropped
       while mountebank was keeping every request. */
    const out = keptFor(mock, false);
    expect(out.kept).toBe(true);
    expect(out.because).toContain('--mock');
  });

  it('says nothing is kept only when it has read the instance', () => {
    expect(keptFor(plain, false).kept).toBe(false);
    expect(keptFor(plain, false).because).toContain('does not run with --mock');
  });

  it('hedges when the instance has not been read', () => {
    const out = keptFor(unread, false);
    expect(out.kept).toBe(false);
    /* No claim about a flag it has not seen. */
    expect(out.because).toContain('unless the instance runs with --mock');
    expect(out.because).not.toContain('does not run');
  });

  it('treats an undefined flag as off, since mountebank omits a false one', () => {
    expect(keptFor(plain, undefined).kept).toBe(false);
  });
});

describe('whyMatchIsComputed', () => {
  it('does not deny the stored response on a --debug instance', () => {
    /* It records the response it sent and the match. Saying otherwise was the error. */
    const text = whyMatchIsComputed(debug);
    expect(text).toContain('--debug');
    expect(text).toContain('does not read that');
    expect(text).not.toContain('keeps neither');
  });

  it('says what is missing, and why, on an ordinary instance', () => {
    expect(whyMatchIsComputed(plain)).toContain('keeps neither the response it sent');
  });

  it('claims nothing about the flags it has not read', () => {
    const text = whyMatchIsComputed(unread);
    expect(text).not.toContain('--debug');
    expect(text).toContain('computed by this panel');
  });
});

describe('matchSource', () => {
  it('credits mountebank with the record it actually has', () => {
    expect(matchSource(debug)).toContain('mountebank also recorded the match');
  });

  it('names the flag rather than mountebank when there is no record', () => {
    expect(matchSource(plain)).toContain('does not run with --debug');
  });
});
