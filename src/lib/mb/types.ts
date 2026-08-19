/**
 * Two type families live here and must not be confused:
 *
 *  Mb*   — Mountebank's own wire format, exactly as its admin API sends and
 *          accepts it. Verified against mountebank 2.9.1 and re-checked against @mbtest/mountebank 2.9.4.
 *  UI     — the editable model the visual editor binds to. Flat, id-bearing,
 *          and lossless in both directions (see model.ts + model.test.ts).
 */

/* ────────────────────────────  Mountebank wire format  ─────────────────── */

export type MbOperator =
  'equals' | 'deepEquals' | 'contains' | 'startsWith' | 'endsWith' | 'matches' | 'exists';

export const MB_OPERATORS: MbOperator[] = [
  'equals',
  'deepEquals',
  'contains',
  'startsWith',
  'endsWith',
  'matches',
  'exists',
];

/** A predicate is an operator key plus optional modifiers, or a group. */
export type MbPredicate = Record<string, unknown>;

export interface MbIs {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: unknown;
  _mode?: 'text' | 'binary';
  /** tcp uses `data`; smtp and custom protocols have fields of their own. */
  [key: string]: unknown;
}

export type MbProxyMode = 'proxyOnce' | 'proxyAlways' | 'proxyTransparent';

/**
 * One entry of a proxy's `predicateGenerators`. `matches` is the part the editor
 * draws; everything beside it (`ignore`, `except`, `caseSensitive`, `xpath`,
 * `jsonpath`, `predicateOperator`, `inject`) is real and has to survive a save, so
 * the type is open.
 */
export interface MbPredicateGenerator {
  matches?: Record<string, boolean>;
  [key: string]: unknown;
}

/** Open for the same reason: `injectHeaders`, `key`, `cert`, `passphrase`. */
export interface MbProxy {
  to: string;
  mode?: MbProxyMode;
  predicateGenerators?: MbPredicateGenerator[];
  addWaitBehavior?: boolean;
  addDecorateBehavior?: string;
  [key: string]: unknown;
}

/** A response that breaks the connection instead of answering it. */
export type MbFault = 'CONNECTION_RESET_BY_PEER' | 'RANDOM_DATA_THEN_CLOSE';

export const MB_FAULTS: MbFault[] = ['CONNECTION_RESET_BY_PEER', 'RANDOM_DATA_THEN_CLOSE'];

export type MbBehaviorName = 'wait' | 'decorate' | 'copy' | 'lookup' | 'shellTransform';
/**
 * Open, so a behavior a later mountebank adds is a value this panel can carry
 * rather than a type error — and, more to the point, rather than a silent deletion.
 */
export type MbBehavior = Partial<Record<MbBehaviorName, unknown>> & Record<string, unknown>;

export interface MbResponse {
  is?: MbIs;
  proxy?: MbProxy;
  inject?: string;
  fault?: MbFault;
  behaviors?: MbBehavior[];
  repeat?: number;
  _proxyResponseTime?: number;
  [key: string]: unknown;
}

export interface MbStub {
  predicates?: MbPredicate[];
  responses?: MbResponse[];
  _links?: unknown;
}

/**
 * What `GET /imposters/:port` returns. Open, because a protocol carries fields of
 * its own — tcp's `mode` and `endOfRequestResolver`, for two — and a write must not
 * quietly drop the ones this editor does not draw.
 */
export interface MbImposter {
  protocol: string;
  port: number;
  name?: string;
  recordRequests?: boolean;
  defaultResponse?: unknown;
  stubs?: MbStub[];
  numberOfRequests?: number;
  requests?: MbRecordedRequest[];
  key?: string;
  cert?: string;
  mutualAuth?: boolean;
  /** Hrefs are http:// even behind a TLS terminator — never follow them. */
  _links?: unknown;
  [key: string]: unknown;
}

export interface MbRecordedRequest {
  requestFrom?: string;
  method?: string;
  path?: string;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string>;
  body?: unknown;
  timestamp?: string;
  ip?: string;
}

/** `GET /config` — how we learn a live instance's version and flags. */
export interface MbConfig {
  version: string;
  options: {
    allowInjection?: boolean;
    /** The CORS allowlist. Absent or false when no origin was allowed. */
    origin?: string | string[] | false;
    configfile?: string;
    localOnly?: boolean;
    ipWhitelist?: string[];
    port?: number;
    mock?: boolean;
    debug?: boolean;
  };
  process?: { uptime?: number; nodeVersion?: string };
}

/* ─────────────────────────────  editable UI model  ─────────────────────── */

export type PredField = 'method' | 'path' | 'body' | 'query' | 'headers';

/**
 * Mountebank compares predicate values BY TYPE: `{equals:{body:"42"}}` and
 * `{equals:{body:42}}` are different predicates and will match different
 * requests. So a condition carries its JSON type explicitly rather than
 * guessing from the text — guessing would silently retype a digits-only reference
 * number on the first save and stop the stub from ever matching again.
 */
export type ValueType = 'string' | 'number' | 'boolean' | 'json';

/** One field comparison inside a predicate. `key` names the header or query param. */
export interface Condition {
  field: PredField;
  key: string;
  /** Always held as text so a half-typed value is never destroyed. */
  value: string;
  type: ValueType;
}

/**
 * One Mountebank predicate object: a single operator applied to one or more
 * fields. The multi-field form — `{equals: {method: 'POST', path: '/x'}}` — is
 * the idiomatic one and the shape Mountebank itself emits, so a predicate carries
 * a LIST of conditions rather than a single field.
 *
 * Splitting them into separate predicates would be wrong: inside an `or` group
 * it silently turns an AND into an OR.
 */
export interface SimplePred {
  kind: 'simple';
  id: string;
  op: MbOperator;
  conditions: Condition[];
  /** jsonpath selector applied to the body before comparing; '' when unused. */
  selector: string;
  caseSensitive: boolean;
}

export interface GroupPred {
  kind: 'group';
  id: string;
  joiner: 'and' | 'or' | 'not';
  preds: Pred[];
}

/** Anything the visual editor does not model, preserved verbatim. */
export interface RawPred {
  kind: 'raw';
  id: string;
  json: string;
}

export type Pred = SimplePred | GroupPred | RawPred;

export type RespType = 'is' | 'proxy' | 'inject' | 'fault';

export interface Behavior {
  id: string;
  type: MbBehaviorName;
  value: string | number;
}

export interface IsResponse {
  /**
   * '' when the wire response had none — a tcp reply is `{data}` with no status at
   * all, and inventing a 200 for it would rewrite a stub nobody edited.
   */
  statusCode: number | string;
  headers: Record<string, string>;
  /** Held as text so a half-typed body is never destroyed. */
  body: string;
  /**
   * Keys of the wire `is` object this editor does not draw — `_mode`, tcp's `data`,
   * anything a custom protocol adds. Carried so a save cannot delete them.
   */
  extras: Record<string, unknown>;
}

export interface ProxyResponse {
  to: string;
  mode: MbProxyMode;
  genMethod: boolean;
  genPath: boolean;
  genQuery: boolean;
  genBody: boolean;
  addWait: boolean;
  decorate: string;
  /**
   * The `predicateGenerators` exactly as they arrived. The four checkboxes above
   * edit `[0].matches` and nothing else, so `ignore`, `except`, selectors and any
   * further generator entries survive untouched.
   */
  generators: MbPredicateGenerator[];
  /** `injectHeaders`, `key`, `cert`, `passphrase` — kept, never drawn. */
  extras: Record<string, unknown>;
}

export interface Resp {
  id: string;
  type: RespType;
  is: IsResponse;
  proxy: ProxyResponse;
  inject: string;
  fault: MbFault;
  behaviors: Behavior[];
  /** Behaviors whose name this editor does not know, written back after the rest. */
  extraBehaviors: MbBehavior[];
  repeat: number;
  /** Keys of the wire response object that are none of the above. */
  extras: Record<string, unknown>;
}

export interface Stub {
  id: string;
  predicates: Pred[];
  responses: Resp[];
}

export interface Imposter {
  /** Mountebank identifies an imposter by port; the port IS the id. */
  port: number;
  name: string;
  protocol: string;
  recordRequests: boolean;
  /** Held as text so invalid JSON mid-edit does not throw. */
  defaultResponse: string;
  key: string;
  cert: string;
  mutualAuth: boolean;
  stubs: Stub[];
  numberOfRequests: number;
  /**
   * Protocol fields this editor does not draw — tcp's `mode` and
   * `endOfRequestResolver`, anything a custom protocol adds. Read-only fields
   * (`_links`, `requests`, `numberOfRequests`) are never in here: mountebank
   * rejects them on write.
   */
  extras: Record<string, unknown>;
}

export interface RecordedRequest {
  id: string;
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  body: string;
  timestamp: number;
  /** Index of the stub whose predicates the request satisfies, or null. */
  matchedStubIndex: number | null;
}
