/**
 * Which stub answered a recorded request?
 *
 * Mountebank only reports that itself when started with `--debug`, and neither
 * dev nor staging is (`GET /config` → debug:false). So we evaluate predicates
 * client-side, mirroring Mountebank's own semantics:
 *
 *   • predicates in a stub's array are ANDed
 *   • the FIRST stub whose predicates all pass wins — later stubs never see it
 *   • comparisons are case-insensitive on both keys and values unless the
 *     predicate sets caseSensitive
 *   • values are compared by JSON type, so "42" never matches 42
 *
 * Being explicit about this beats guessing in the UI: the panel labels the
 * result as computed, so nobody mistakes it for something Mountebank asserted.
 */

import { toJsonValue } from './model';
import type { Condition, MbRecordedRequest, Pred, PredField, Stub } from './types';

const lower = (v: unknown): unknown => (typeof v === 'string' ? v.toLowerCase() : v);

/** Case-folds keys and string values, the way mountebank does by default. */
function fold(value: unknown, caseSensitive: boolean): unknown {
  if (caseSensitive) return value;
  if (Array.isArray(value)) return value.map((v) => fold(v, false));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k.toLowerCase(),
        fold(v, false),
      ]),
    );
  }
  return lower(value);
}

/** Reads the request field a condition targets. */
function readField(req: MbRecordedRequest, c: Condition): unknown {
  switch (c.field) {
    case 'method':
      return req.method;
    case 'path':
      return req.path;
    case 'body':
      return typeof req.body === 'string' ? req.body : req.body;
    case 'query':
      return req.query?.[c.key];
    case 'headers':
      return pickInsensitive(req.headers, c.key);
    default:
      return undefined;
  }
}

function pickInsensitive(bag: Record<string, string> | undefined, key: string): string | undefined {
  if (!bag) return undefined;
  const hit = Object.keys(bag).find((k) => k.toLowerCase() === key.toLowerCase());
  return hit ? bag[hit] : undefined;
}

/** Applies a jsonpath-ish selector (`$..field` / `$.a.b`) to a JSON body. */
function selectFromBody(body: unknown, selector: string): unknown {
  const raw = typeof body === 'string' ? safeParse(body) : body;
  if (raw === undefined) return undefined;

  const recursive = selector.startsWith('$..');
  const path = selector
    .replace(/^\$\.\.?/, '')
    .split('.')
    .filter(Boolean);
  if (!path.length) return raw;

  if (recursive && path.length === 1) return findDeep(raw, path[0]);

  let cursor: unknown = raw;
  for (const segment of path) {
    if (cursor && typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return cursor;
}

function findDeep(node: unknown, key: string): unknown {
  if (!node || typeof node !== 'object') return undefined;
  if (!Array.isArray(node) && key in (node as Record<string, unknown>)) {
    return (node as Record<string, unknown>)[key];
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    const hit = findDeep(value, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const safeParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const asText = (v: unknown): string =>
  v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);

function conditionHolds(
  req: MbRecordedRequest,
  p: Extract<Pred, { kind: 'simple' }>,
  c: Condition,
): boolean {
  const actualRaw =
    p.selector && c.field === 'body' ? selectFromBody(req.body, p.selector) : readField(req, c);

  if (p.op === 'exists') {
    const present = actualRaw !== undefined && actualRaw !== null && actualRaw !== '';
    return toJsonValue(c.value, c.type) === false ? !present : present;
  }
  if (actualRaw === undefined) return false;

  const expected = toJsonValue(c.value, c.type);
  const a = fold(actualRaw, p.caseSensitive);
  const b = fold(expected, p.caseSensitive);

  switch (p.op) {
    case 'equals':
      return typeof b === 'object' ? deepEqual(a, b) : looseEquals(a, b);
    case 'deepEquals':
      return deepEqual(a, b);
    case 'contains':
      return asText(a).includes(asText(b));
    case 'startsWith':
      return asText(a).startsWith(asText(b));
    case 'endsWith':
      return asText(a).endsWith(asText(b));
    case 'matches':
      try {
        return new RegExp(asText(expected), p.caseSensitive ? '' : 'i').test(asText(actualRaw));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * mountebank's `equals` on a JSON body compares the parsed sub-document when the
 * expectation is an object, and otherwise compares scalars by value+type.
 */
function looseEquals(a: unknown, b: unknown): boolean {
  if (typeof a === typeof b) return a === b;
  // a body arrives as text; a numeric expectation must still be type-exact
  if (typeof b === 'number' || typeof b === 'boolean') return false;
  return asText(a) === asText(b);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const pa = typeof a === 'string' ? (safeParse(a) ?? a) : a;
  if (pa === b) return true;
  if (!pa || !b || typeof pa !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(pa as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((pa as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

export function predicateHolds(req: MbRecordedRequest, p: Pred): boolean {
  if (p.kind === 'raw') return false; // cannot evaluate what we cannot model
  if (p.kind === 'group') {
    if (p.joiner === 'not') return !p.preds.every((inner) => predicateHolds(req, inner));
    if (p.joiner === 'or') return p.preds.some((inner) => predicateHolds(req, inner));
    return p.preds.every((inner) => predicateHolds(req, inner));
  }
  return p.conditions.every((c) => conditionHolds(req, p, c));
}

export const stubMatches = (req: MbRecordedRequest, stub: Stub): boolean =>
  stub.predicates.every((p) => predicateHolds(req, p));

/** First match wins, exactly as mountebank resolves a request. */
export function findMatchingStub(req: MbRecordedRequest, stubs: Stub[]): number | null {
  const index = stubs.findIndex((stub) => stubMatches(req, stub));
  return index === -1 ? null : index;
}

/** Fields a raw predicate blocks us from evaluating — surfaced honestly in the UI. */
export const hasUnevaluablePredicate = (stub: Stub): boolean =>
  stub.predicates.some(function walk(p: Pred): boolean {
    if (p.kind === 'raw') return true;
    if (p.kind === 'group') return p.preds.some(walk);
    return false;
  });

export type { PredField };
