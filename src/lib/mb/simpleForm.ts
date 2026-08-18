/**
 * The friendly shape of a stub's matching rules.
 *
 * The canonical model (`Pred[]`) mirrors Mountebank exactly: an operator applied
 * to a bag of fields, optionally nested in and/or/not groups. That is faithful,
 * but editing it directly turns the screen into a query builder — pick a field,
 * pick an operator, type a value, repeat.
 *
 * This module projects the same rules onto the shape of the HTTP request being
 * matched, which is how people actually think about a mock:
 *
 *     Method   POST
 *     Path     /v1/orders                       (exactly · starts with · …)
 *     Query    region = eu
 *     Headers  X-Api-Key = …
 *     Body     the field $..customerRef equals CUST-1024
 *
 * Anything the plain form cannot say — an or/not group, a deepEquals, a
 * case-sensitive comparison, a predicate we do not model — is NOT dropped. It
 * lands in `extras` and is written back verbatim, so opening a stub in this
 * editor can never quietly simplify it.
 */

import { mkCondition, mkPred, uid } from './model';
import type { Condition, MbOperator, Pred, SimplePred, ValueType } from './types';

export type PathMode = 'exactly' | 'startsWith' | 'endsWith' | 'contains' | 'regex';

export const PATH_MODES: { value: PathMode; label: string }[] = [
  { value: 'exactly', label: 'is exactly' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'contains', label: 'contains' },
  { value: 'regex', label: 'matches the pattern' },
];

const PATH_OP: Record<PathMode, MbOperator> = {
  exactly: 'equals',
  startsWith: 'startsWith',
  endsWith: 'endsWith',
  contains: 'contains',
  regex: 'matches',
};

const MODE_BY_OP: Partial<Record<MbOperator, PathMode>> = {
  equals: 'exactly',
  startsWith: 'startsWith',
  endsWith: 'endsWith',
  contains: 'contains',
  matches: 'regex',
};

export type BodyMode = 'any' | 'contains' | 'equals' | 'field';

export const BODY_MODES: { value: BodyMode; label: string; hint: string }[] = [
  { value: 'any', label: 'Any body', hint: 'The body is not looked at.' },
  {
    value: 'contains',
    label: 'Contains text',
    hint: 'Matches if the raw body contains this text.',
  },
  { value: 'equals', label: 'Is exactly', hint: 'The whole body must match, byte for byte.' },
  {
    value: 'field',
    label: 'A field equals',
    hint: 'Pulls one field out of a JSON body and compares it.',
  },
];

/** One key/value line under Query or Headers. */
export interface KeyMatch {
  id: string;
  key: string;
  value: string;
  type: ValueType;
}

export interface SimpleForm {
  /** '' means any method. */
  method: string;
  /** '' means any path. */
  path: string;
  pathMode: PathMode;
  query: KeyMatch[];
  headers: KeyMatch[];
  bodyMode: BodyMode;
  /** The text compared against, for every body mode except 'any'. */
  bodyValue: string;
  bodyType: ValueType;
  /** jsonpath selector, used only by the 'field' body mode. */
  bodyField: string;
  /** Rules the plain form cannot express. Preserved exactly as they arrived. */
  extras: Pred[];
}

export const emptyForm = (): SimpleForm => ({
  method: '',
  path: '',
  pathMode: 'exactly',
  query: [],
  headers: [],
  bodyMode: 'any',
  bodyValue: '',
  bodyType: 'string',
  bodyField: '',
  extras: [],
});

export const mkKeyMatch = (patch: Partial<KeyMatch> = {}): KeyMatch => ({
  id: uid('k'),
  key: '',
  value: '',
  type: 'string',
  ...patch,
});

/** True when a predicate carries anything the plain form would silently lose. */
function isPlainEnough(p: Pred): p is SimplePred {
  if (p.kind !== 'simple') return false;
  if (p.caseSensitive) return false;
  return true;
}

/* ────────────────────────────  Pred[] → SimpleForm  ─────────────────────── */

export function toSimpleForm(predicates: Pred[]): SimpleForm {
  const form = emptyForm();
  // a field may only be claimed once; a second mention has to go to extras or the
  // form would show one rule and enforce two
  let methodTaken = false;
  let pathTaken = false;
  let bodyTaken = false;

  for (const pred of predicates) {
    if (!isPlainEnough(pred)) {
      form.extras.push(pred);
      continue;
    }

    const leftovers: Condition[] = [];

    for (const c of pred.conditions) {
      if (c.field === 'method' && pred.op === 'equals' && !methodTaken) {
        form.method = c.value.toUpperCase();
        methodTaken = true;
      } else if (c.field === 'path' && MODE_BY_OP[pred.op] !== undefined && !pathTaken) {
        form.path = c.value;
        form.pathMode = MODE_BY_OP[pred.op] as PathMode;
        pathTaken = true;
      } else if ((c.field === 'query' || c.field === 'headers') && pred.op === 'equals') {
        form[c.field].push(mkKeyMatch({ key: c.key, value: c.value, type: c.type }));
      } else if (c.field === 'body' && !bodyTaken && bodyModeFor(pred) !== null) {
        form.bodyMode = bodyModeFor(pred) as BodyMode;
        form.bodyValue = c.value;
        form.bodyType = c.type;
        form.bodyField = pred.selector;
        bodyTaken = true;
      } else {
        leftovers.push(c);
      }
    }

    // conditions the form could not take keep their operator and their siblings
    if (leftovers.length > 0) {
      form.extras.push({ ...pred, id: uid('p'), conditions: leftovers });
    }
  }

  return form;
}

function bodyModeFor(pred: SimplePred): BodyMode | null {
  if (pred.selector !== '' && pred.op === 'equals') return 'field';
  if (pred.selector !== '') return null;
  if (pred.op === 'contains') return 'contains';
  if (pred.op === 'equals') return 'equals';
  return null;
}

/* ────────────────────────────  SimpleForm → Pred[]  ─────────────────────── */

export function fromSimpleForm(form: SimpleForm): Pred[] {
  const out: Pred[] = [];

  /*
   * Method and an exact path go into ONE `equals` predicate. That is the shape
   * Mountebank itself emits, so a stub read from an instance and saved again comes
   * back unchanged instead of being restructured.
   */
  const exact: Condition[] = [];
  if (form.method.trim() !== '') {
    exact.push(mkCondition({ field: 'method', value: form.method.trim().toUpperCase() }));
  }
  if (form.path.trim() !== '' && form.pathMode === 'exactly') {
    exact.push(mkCondition({ field: 'path', value: form.path.trim() }));
  }
  if (exact.length > 0) out.push(mkPred({ op: 'equals', conditions: exact }));

  if (form.path.trim() !== '' && form.pathMode !== 'exactly') {
    out.push(
      mkPred({
        op: PATH_OP[form.pathMode],
        conditions: [mkCondition({ field: 'path', value: form.path.trim() })],
      }),
    );
  }

  for (const field of ['query', 'headers'] as const) {
    for (const row of form[field]) {
      if (row.key.trim() === '') continue;
      out.push(
        mkPred({
          op: 'equals',
          conditions: [
            mkCondition({ field, key: row.key.trim(), value: row.value, type: row.type }),
          ],
        }),
      );
    }
  }

  if (form.bodyMode !== 'any') {
    const op: MbOperator = form.bodyMode === 'contains' ? 'contains' : 'equals';
    out.push(
      mkPred({
        op,
        selector: form.bodyMode === 'field' ? form.bodyField.trim() : '',
        conditions: [mkCondition({ field: 'body', value: form.bodyValue, type: form.bodyType })],
      }),
    );
  }

  return [...out, ...form.extras];
}

/* ─────────────────────────────  reading it back  ────────────────────────── */

/** A one-line, human-readable account of an extra rule, for the list that shows them. */
export function describeExtra(pred: Pred): string {
  if (pred.kind === 'raw') return 'A rule this editor does not model';
  if (pred.kind === 'group') {
    const word = pred.joiner === 'not' ? 'none of' : pred.joiner === 'or' ? 'any of' : 'all of';
    return `${word} ${pred.preds.length} nested ${pred.preds.length === 1 ? 'rule' : 'rules'}`;
  }
  const fields = pred.conditions
    .map((c) => (c.key === '' ? c.field : `${c.field}.${c.key}`))
    .join(', ');
  return `${pred.op} on ${fields}${pred.caseSensitive ? ' (case sensitive)' : ''}`;
}

/** Whether this stub is fully expressible in the plain form. */
export const isPlainStub = (predicates: Pred[]): boolean =>
  toSimpleForm(predicates).extras.length === 0;
