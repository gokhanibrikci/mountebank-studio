/**
 * The lossless bridge between Mountebank's wire format and the editable model.
 *
 * These functions are the load-bearing part of the whole app: the Visual ⇄ JSON
 * toggle, the imposter JSON tab and every write to the admin API all pass
 * through them. `model.test.ts` asserts round-trip identity, so a change that
 * silently drops a field fails the suite rather than corrupting someone's mock.
 */

import {
  MB_OPERATORS,
  type MbPredicateGenerator,
  type Behavior,
  type Condition,
  type ValueType,
  type GroupPred,
  type Imposter,
  type MbBehavior,
  type MbBehaviorName,
  type MbImposter,
  type MbIs,
  type MbOperator,
  type MbPredicate,
  type MbResponse,
  type MbStub,
  type Pred,
  type PredField,
  type Resp,
  type RespType,
  type SimplePred,
  type Stub,
} from './types';

let seq = 0;
export const uid = (prefix: string): string =>
  `${prefix}_${(++seq).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const pretty = (value: unknown): string => JSON.stringify(value, null, 2);

/* ───────────────────────────────  factories  ───────────────────────────── */

export const mkCondition = (patch: Partial<Condition> = {}): Condition => ({
  field: 'path',
  key: '',
  value: '',
  type: 'string',
  ...patch,
});

export const mkPred = (patch: Partial<SimplePred> = {}): SimplePred => ({
  kind: 'simple',
  id: uid('p'),
  op: 'equals',
  conditions: [mkCondition()],
  selector: '',
  caseSensitive: false,
  ...patch,
});

/** Shorthand for the common single-condition predicate. */
export const mkPred1 = (
  field: PredField,
  value: string,
  patch: Partial<SimplePred> = {},
): SimplePred => mkPred({ conditions: [mkCondition({ field, value })], ...patch });

export const mkGroup = (joiner: GroupPred['joiner'] = 'or'): GroupPred => ({
  kind: 'group',
  id: uid('g'),
  joiner,
  preds: [mkPred1('body', '')],
});

export const INJECT_SAMPLE = `function (request, state, logger) {
  const body = JSON.parse(request.body || '{}');
  logger.info('order for ' + body.customerRef);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderRef: 'ORD-' + Date.now(),
      accepted: body.customerRef !== 'CUST-BLOCKED'
    })
  };
}`;

export const mkResp = (type: RespType = 'is', patch: Partial<Resp> = {}): Resp => ({
  id: uid('r'),
  type,
  is: {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    extras: {},
  },
  proxy: {
    to: 'https://',
    mode: 'proxyOnce',
    genMethod: true,
    genPath: true,
    genQuery: false,
    genBody: false,
    addWait: false,
    decorate: '',
    generators: [],
    extras: {},
  },
  inject: INJECT_SAMPLE,
  fault: 'CONNECTION_RESET_BY_PEER',
  behaviors: [],
  extraBehaviors: [],
  repeat: 1,
  extras: {},
  ...patch,
});

export const mkStub = (patch: Partial<Stub> = {}): Stub => ({
  id: uid('s'),
  predicates: [mkPred1('method', 'POST'), mkPred1('path', '/')],
  responses: [mkResp()],
  ...patch,
});

export const mkImposter = (patch: Partial<Imposter> = {}): Imposter => ({
  port: 0,
  name: '',
  protocol: 'http',
  recordRequests: true,
  defaultResponse: '',
  key: '',
  cert: '',
  mutualAuth: false,
  stubs: [],
  numberOfRequests: 0,
  extras: {},
  ...patch,
});

/* ─────────────────────────  helpers  ─────────────────────── */

export const needsKey = (field: PredField): boolean => field === 'query' || field === 'headers';

/** The JSON type a wire value had, so it can be written back unchanged. */
export const typeOf = (value: unknown): ValueType => {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value !== null && typeof value === 'object') return 'json';
  return 'string';
};

/** Text plus its declared type → the JSON value mountebank compares against. */
export const toJsonValue = (value: string, type: ValueType): unknown => {
  switch (type) {
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    case 'boolean':
      return value === 'true';
    case 'json':
      try {
        return JSON.parse(value);
      } catch {
        return value; // an unfinished draft stays text rather than throwing
      }
    default:
      return value;
  }
};

/**
 * What pasted text most likely is. Offered as a one-click suggestion in the
 * editor and never applied on its own — retyping a value changes what matches.
 */
export const guessType = (value: string): ValueType => {
  if (value === 'true' || value === 'false') return 'boolean';
  if (value !== '' && /^-?\d+(\.\d+)?$/.test(value) && String(Number(value)) === value)
    return 'number';
  if (/^\s*[[{]/.test(value)) return 'json';
  return 'string';
};

/* ────────────────────────  UI model → Mountebank  ──────────────────────── */

export function predToMb(p: Pred): MbPredicate {
  if (p.kind === 'raw') {
    try {
      return JSON.parse(p.json) as MbPredicate;
    } catch {
      return {};
    }
  }

  if (p.kind === 'group') {
    const inner = p.preds.map(predToMb);
    return p.joiner === 'not' ? { not: inner[0] ?? {} } : { [p.joiner]: inner };
  }

  // one operator, every condition folded into a single field bag — the shape
  // mountebank itself emits
  const bag: Record<string, unknown> = {};

  for (const c of p.conditions) {
    const value = p.op === 'exists' ? true : toJsonValue(c.value, c.type);

    if (c.field === 'query' || c.field === 'headers') {
      const nested = (bag[c.field] as Record<string, unknown> | undefined) ?? {};
      nested[c.key || 'key'] = value;
      bag[c.field] = nested;
    } else {
      bag[c.field] = value;
    }
  }

  const out: MbPredicate = { [p.op]: bag };
  // mountebank takes the selector as a sibling of the operator, not nested
  if (p.selector) out.jsonpath = { selector: p.selector };
  if (p.caseSensitive) out.caseSensitive = true;
  return out;
}

/** The keys of one object minus a list of names, for carrying the rest verbatim. */
export function rest(source: Record<string, unknown>, drawn: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!drawn.includes(key)) out[key] = value;
  }
  return out;
}

export function respToMb(r: Resp): MbResponse {
  /*
   * Anything this editor never drew is written back too. `rest()` builds each
   * extras bag from the keys NOT drawn, so the two sets are disjoint and the order
   * below — drawn first, carried second — reproduces the original key order rather
   * than inverting it. Without carrying them at all, a `fault` response, a tcp
   * `is.data`, injected proxy headers or an unknown behavior would be deleted by
   * the act of opening a stub and saving it.
   */
  const out: MbResponse = {};

  if (r.type === 'is') {
    // write only what the user actually set — mountebank defaults the rest, and
    // adding empty keys would rewrite stubs that never had them
    const is: MbIs = {};

    /* A status only when there is one to write: see IsResponse.statusCode. */
    if (String(r.is.statusCode).trim() !== '') is.statusCode = Number(r.is.statusCode) || 200;

    if (Object.keys(r.is.headers).length) is.headers = r.is.headers;

    if (r.is.body !== '') {
      try {
        is.body = JSON.parse(r.is.body);
      } catch {
        is.body = r.is.body; // a non-JSON body is legitimate — keep the text
      }
    }

    out.is = { ...is, ...r.is.extras };
  } else if (r.type === 'proxy') {
    const matches: Record<string, boolean> = {};
    if (r.proxy.genMethod) matches.method = true;
    if (r.proxy.genPath) matches.path = true;
    if (r.proxy.genQuery) matches.query = true;
    if (r.proxy.genBody) matches.body = true;

    /* The checkboxes own `[0].matches`. Every other key of that generator, and
       every further generator, is the user's and is left exactly as it was. */
    const generators: MbPredicateGenerator[] =
      r.proxy.generators.length > 0
        ? r.proxy.generators.map((g, i) => (i === 0 ? { ...g, matches } : { ...g }))
        : [{ matches }];

    out.proxy = {
      to: r.proxy.to,
      mode: r.proxy.mode,
      predicateGenerators: generators,
    };
    if (r.proxy.addWait) out.proxy.addWaitBehavior = true;
    if (r.proxy.decorate) out.proxy.addDecorateBehavior = r.proxy.decorate;
    Object.assign(out.proxy, r.proxy.extras);
  } else if (r.type === 'fault') {
    out.fault = r.fault;
  } else {
    out.inject = r.inject;
  }

  const drawn = r.behaviors.map(
    (b) => ({ [b.type]: b.type === 'wait' ? Number(b.value) || 0 : b.value }) as MbBehavior,
  );
  const behaviors = [...drawn, ...r.extraBehaviors];
  if (behaviors.length) out.behaviors = behaviors;
  if (Number(r.repeat) > 1) out.repeat = Number(r.repeat);

  return { ...out, ...r.extras };
}

export const stubToMb = (s: Stub): MbStub => ({
  predicates: s.predicates.map(predToMb),
  responses: s.responses.map(respToMb),
});

/** Sent by mountebank, rejected by mountebank on write. Never carried. */
const READ_ONLY_IMPOSTER = ['numberOfRequests', 'requests', 'stubs', '_links'];
const DRAWN_IMPOSTER = [
  'protocol',
  'port',
  'name',
  'recordRequests',
  'defaultResponse',
  'key',
  'cert',
  'mutualAuth',
];

export function imposterToMb(imp: Imposter): MbImposter {
  /*
   * An absent port is OMITTED, not sent as null.
   *
   * `Number(undefined)` is NaN and JSON.stringify writes that as `null`, which mountebank
   * answers with a 500 and an HTML error page. Left out entirely it assigns a free port
   * and returns 201 — which is what the import screen promises for a file whose imposter
   * has no port. Measured on 2.9.4.
   */
  const port = Number(imp.port);
  const out: MbImposter = {
    protocol: imp.protocol,
    ...(Number.isFinite(port) && port > 0 ? { port } : {}),
    name: imp.name,
    recordRequests: !!imp.recordRequests,
  };

  if (imp.defaultResponse.trim()) {
    try {
      out.defaultResponse = JSON.parse(imp.defaultResponse);
    } catch {
      /* an unparseable draft is simply not sent */
    }
  }

  if (imp.protocol === 'https') {
    if (imp.key) out.key = imp.key;
    if (imp.cert) out.cert = imp.cert;
    if (imp.mutualAuth) out.mutualAuth = true;
  }

  /* tcp's `mode`, `endOfRequestResolver`, anything a custom protocol adds. */
  Object.assign(out, imp.extras);

  out.stubs = imp.stubs.map(stubToMb);
  return out;
}

/* ────────────────────────  Mountebank → UI model  ──────────────────────── */

const isOperator = (k: string): k is MbOperator => (MB_OPERATORS as string[]).includes(k);

export function predFromMb(o: MbPredicate): Pred {
  const keys = Object.keys(o ?? {});

  if (keys.includes('or') || keys.includes('and')) {
    const joiner = keys.includes('or') ? 'or' : 'and';
    const list = (o[joiner] as MbPredicate[]) ?? [];
    return { kind: 'group', id: uid('g'), joiner, preds: list.map(predFromMb) };
  }
  if (keys.includes('not')) {
    return {
      kind: 'group',
      id: uid('g'),
      joiner: 'not',
      preds: [predFromMb(o.not as MbPredicate)],
    };
  }

  const op = keys.find(isOperator);
  if (!op) return { kind: 'raw', id: uid('p'), json: pretty(o) };

  const spec = (o[op] ?? {}) as Record<string, unknown>;
  const caseSensitive = !!o.caseSensitive;
  const selector = o.jsonpath ? ((o.jsonpath as { selector?: string }).selector ?? '') : '';

  const conditions: Condition[] = [];
  for (const [field, raw] of Object.entries(spec)) {
    if (field === 'query' || field === 'headers') {
      if (!raw || typeof raw !== 'object') return { kind: 'raw', id: uid('p'), json: pretty(o) };
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        conditions.push({
          field,
          key,
          value: typeOf(value) === 'json' ? pretty(value) : String(value ?? ''),
          type: typeOf(value),
        });
      }
    } else if (field === 'method' || field === 'path' || field === 'body') {
      conditions.push({
        field,
        key: '',
        value: typeOf(raw) === 'json' ? pretty(raw) : String(raw),
        type: typeOf(raw),
      });
    } else {
      // an operand the visual editor cannot represent — keep the whole predicate
      return { kind: 'raw', id: uid('p'), json: pretty(o) };
    }
  }

  if (!conditions.length) return { kind: 'raw', id: uid('p'), json: pretty(o) };
  return mkPred({ op, conditions, selector, caseSensitive });
}

const KNOWN_BEHAVIORS: MbBehaviorName[] = ['wait', 'decorate', 'copy', 'lookup', 'shellTransform'];

/** Response keys this editor draws; the rest are carried on `Resp.extras`. */
const DRAWN_RESPONSE = ['is', 'proxy', 'inject', 'fault', 'behaviors', 'repeat'];
const DRAWN_IS = ['statusCode', 'headers', 'body'];
const DRAWN_PROXY = ['to', 'mode', 'predicateGenerators', 'addWaitBehavior', 'addDecorateBehavior'];

export function respFromMb(o: MbResponse): Resp {
  const r = mkResp('is');
  r.extras = rest(o as Record<string, unknown>, DRAWN_RESPONSE);

  if (o.proxy) {
    r.type = 'proxy';
    const generators = o.proxy.predicateGenerators ?? [];
    const matches = generators[0]?.matches ?? {};
    r.proxy = {
      to: o.proxy.to ?? '',
      mode: o.proxy.mode ?? 'proxyOnce',
      genMethod: !!matches.method,
      genPath: !!matches.path,
      genQuery: !!matches.query,
      genBody: !!matches.body,
      addWait: !!o.proxy.addWaitBehavior,
      decorate: o.proxy.addDecorateBehavior ?? '',
      generators,
      extras: rest(o.proxy as Record<string, unknown>, DRAWN_PROXY),
    };
  } else if (o.inject) {
    r.type = 'inject';
    r.inject = o.inject;
  } else if (o.fault) {
    /* A response that breaks the connection. Read as a canned 200 before this
       branch existed, which turned a failure mock into a success mock on save. */
    r.type = 'fault';
    r.fault = o.fault;
  } else {
    const is = o.is ?? {};
    r.is = {
      statusCode: is.statusCode ?? '',
      headers: is.headers ?? {},
      // an absent body must stay absent, not become an empty object
      body: is.body === undefined ? '' : typeof is.body === 'string' ? is.body : pretty(is.body),
      extras: rest(is as Record<string, unknown>, DRAWN_IS),
    };
  }

  const known = (b: MbBehavior): boolean => {
    const [type] = Object.keys(b) as MbBehaviorName[];
    return KNOWN_BEHAVIORS.includes(type);
  };

  r.behaviors = (o.behaviors ?? []).filter(known).map((b): Behavior => {
    const [type] = Object.keys(b) as MbBehaviorName[];
    return { id: uid('b'), type, value: b[type] as string | number };
  });
  /* A behavior this editor has no field for still belongs to the stub. */
  r.extraBehaviors = (o.behaviors ?? []).filter((b) => !known(b));

  r.repeat = o.repeat ?? 1;
  return r;
}

export const stubFromMb = (o: MbStub): Stub => ({
  id: uid('s'),
  predicates: (o.predicates ?? []).map(predFromMb),
  responses: (o.responses ?? []).map(respFromMb),
});

export function imposterFromMb(o: MbImposter): Imposter {
  return mkImposter({
    port: o.port,
    name: o.name ?? `imposter-${o.port}`,
    protocol: o.protocol,
    recordRequests: !!o.recordRequests,
    defaultResponse: o.defaultResponse ? pretty(o.defaultResponse) : '',
    key: o.key ?? '',
    cert: o.cert ?? '',
    mutualAuth: !!o.mutualAuth,
    extras: rest(o as Record<string, unknown>, [...DRAWN_IMPOSTER, ...READ_ONLY_IMPOSTER]),
    numberOfRequests: o.numberOfRequests ?? 0,
    stubs: (o.stubs ?? []).map(stubFromMb),
  });
}
