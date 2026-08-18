/**
 * Stub summaries — the WHEN / RESPOND ledger.
 *
 * These turn a stub into the one-line plain reading that the stub card, the
 * palette, the drawer subtitle and the breadcrumbs all show. Every function
 * returns a plain string: React escapes it for free, and the same text can be
 * used in a `title` attribute or a search index without a second code path.
 *
 * Ported from the prototype onto the multi-condition model. One predicate is
 * ONE operator over a LIST of conditions, so `{equals:{method:'POST',path:'/x'}}`
 * reads as a single clause with two parts rather than two separate predicates.
 */

import { STATUS_TEXT, statusTone, type StatusTone } from './format';
import { toJsonValue } from './mb/model';
import type { Condition, MbOperator, Pred, Resp, RespType, SimplePred, Stub } from './mb/types';

/* ────────────────────────────  the operator symbols  ───────────────────── */

/** How each operator is spoken in the ledger. */
const OP_SYMBOL: Record<MbOperator, string> = {
  equals: '==',
  deepEquals: '≡',
  contains: 'contains',
  startsWith: 'starts',
  endsWith: 'ends',
  matches: '~',
  exists: 'exists',
};

/* ──────────────────────────────  signature  ────────────────────────────── */

export interface StubSignature {
  /** Uppercased HTTP verb, or 'ANY' when no method condition pins it down. */
  method: string;
  /** The path the stub answers on, or '*' when it does not constrain the path. */
  path: string;
}

/**
 * The METHOD + PATH headline of a stub.
 *
 * Only top-level simple predicates count: a method buried inside an `or` group
 * does not describe the stub as a whole, so claiming it in the headline would
 * be a lie. The first condition of each kind wins, which keeps the headline
 * stable no matter how the predicates are later reordered.
 */
export function sigOf(stub: Stub): StubSignature {
  let method = 'ANY';
  let path = '*';
  let haveMethod = false;
  let havePath = false;

  for (const pred of stub.predicates) {
    if (pred.kind !== 'simple') continue;
    for (const c of pred.conditions) {
      if (c.field === 'method' && !haveMethod) {
        method = (c.value || 'ANY').toUpperCase();
        haveMethod = true;
      } else if (c.field === 'path' && !havePath) {
        path = c.value || '*';
        havePath = true;
      }
    }
  }

  return { method, path };
}

/* ────────────────────────────────  WHEN  ───────────────────────────────── */

/**
 * How a condition's target is named. A body condition carrying a jsonpath
 * selector reads as `body.<field>` — that is the form the request bodies in
 * this gateway are actually keyed by, so it is the form worth showing.
 */
function fieldLabel(c: Condition, selector: string): string {
  if (c.field === 'body' && selector) {
    return `body.${selector.replace(/^\$\.\.?/, '')}`;
  }
  if (c.field === 'query' || c.field === 'headers') {
    return `${c.field}.${c.key || '?'}`;
  }
  return c.field;
}

/**
 * The expected value as JSON, so its type is visible: a digits-only reference
 * shows as `"00123456"` and a numeric amount as `1500`. Mountebank compares by
 * type, and the ledger is the one place that difference is legible.
 */
function literal(c: Condition): string {
  const value = toJsonValue(c.value, c.type);
  return JSON.stringify(value) ?? c.value;
}

/** One field comparison, e.g. `body.customerRef == "CUST-1024"`. */
function clauseOf(pred: SimplePred, c: Condition): string {
  const label = fieldLabel(c, pred.selector);

  if (pred.op === 'exists') {
    // `exists:false` is a real predicate and means the opposite — say so.
    return toJsonValue(c.value, c.type) === false ? `${label} does not exist` : `${label} exists`;
  }

  return `${label} ${OP_SYMBOL[pred.op]} ${literal(c)}`;
}

/** Every condition of one predicate, ANDed — mountebank's own semantics. */
const simpleText = (pred: SimplePred, conditions: Condition[]): string =>
  conditions.map((c) => clauseOf(pred, c)).join(' AND ');

/** A single predicate, read out in full. Groups keep their parentheses. */
export function conditionText(pred: Pred): string {
  if (pred.kind === 'raw') return 'custom predicate';

  if (pred.kind === 'group') {
    if (pred.joiner === 'not') {
      return `NOT (${pred.preds.map(conditionText).join(' ')})`;
    }
    return `(${pred.preds.map(conditionText).join(` ${pred.joiner.toUpperCase()} `)})`;
  }

  if (!pred.conditions.length) return 'custom predicate';
  return simpleText(pred, pred.conditions);
}

/**
 * The WHEN line: everything that narrows the stub BEYOND its method and path,
 * since those already appear in the headline. A predicate that carries method
 * or path alongside a real condition still contributes that condition, so a
 * multi-condition predicate is never dropped wholesale.
 */
export function whenOf(stub: Stub): string {
  if (!stub.predicates.length) return 'every request — no conditions set';

  const parts: string[] = [];

  for (const pred of stub.predicates) {
    if (pred.kind === 'simple') {
      const rest = pred.conditions.filter((c) => c.field !== 'method' && c.field !== 'path');
      if (!rest.length) continue;
      parts.push(simpleText(pred, rest));
    } else {
      parts.push(conditionText(pred));
    }
  }

  if (!parts.length) return 'any request matching the path';
  return parts.join(' AND ');
}

/* ───────────────────────────────  RESPOND  ─────────────────────────────── */

/** What one response does, e.g. `200 OK · Static` or `Proxy → https://…`. */
function respondPart(r: Resp): string {
  if (r.type === 'proxy') return `Proxy → ${r.proxy.to}`;
  if (r.type === 'inject') return 'Dynamic · Inject';
  if (r.type === 'fault') {
    return r.fault === 'RANDOM_DATA_THEN_CLOSE'
      ? 'Fault · garbage, then close'
      : 'Fault · connection reset';
  }

  /* A reply with no status is not an HTTP one — a tcp stub answers with data. */
  if (String(r.is.statusCode).trim() === '') return 'Static';

  const code = Number(r.is.statusCode);
  const head = Number.isFinite(code) ? String(code) : String(r.is.statusCode);
  const name = Number.isFinite(code) ? STATUS_TEXT[code] : undefined;
  return `${[head, name].filter(Boolean).join(' ')} · Static`;
}

/**
 * The RESPOND line. Several responses on one stub are a cycle in mountebank —
 * it walks them in order and wraps around — so they are joined with "then" and
 * labelled, rather than shown as if only the first one mattered.
 */
export function respondOf(stub: Stub): string {
  const parts = stub.responses.map(respondPart);
  let text = parts.length > 1 ? parts.join(' then ') : (parts[0] ?? 'no response');

  const behaviors = stub.responses.flatMap((r) =>
    r.behaviors.map((b) => (b.type === 'wait' ? `wait ${b.value}ms` : b.type)),
  );
  const repeats = stub.responses.filter((r) => Number(r.repeat) > 1).map((r) => `×${r.repeat}`);

  const extra = [...new Set([...behaviors, ...repeats])];
  if (extra.length) text += ` · ${extra.join(' · ')}`;
  if (parts.length > 1) text += ' (cycles)';

  return text;
}

/** The response kind, as the pill on a stub card names it. */
export const RTYPE: Record<RespType, string> = {
  is: 'Static',
  proxy: 'Proxy',
  inject: 'Dynamic',
  fault: 'Fault',
};

/** 'acc' for anything dynamic; otherwise the tone of the first status code. */
export type RespTone = StatusTone | 'acc';

export function respTone(stub: Stub): RespTone {
  const first = stub.responses[0];
  if (!first) return '';
  if (first.type !== 'is') return 'acc';
  return statusTone(Number(first.is.statusCode));
}
