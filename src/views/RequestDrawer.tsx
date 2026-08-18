/**
 * One captured request, in full.
 *
 * Two honesty problems this screen exists to solve, both consequences of what
 * mountebank actually stores:
 *
 *  1. It does not report which stub answered a request unless it was started
 *     with `--debug`, and neither instance was. The match is therefore COMPUTED
 *     from the predicates (`match.ts`) and labelled as computed. A stub holding
 *     a predicate the editor cannot model makes the verdict unconfirmed rather
 *     than a silent non-match.
 *
 *  2. It does not store the response it sent — the request log is requests only.
 *     So the response shown here is DERIVED from the matched stub, and says so.
 *     A proxy or an injected response cannot be reconstructed at all, and that
 *     is stated rather than papered over with a plausible-looking body.
 *
 * `deriveOutcome` is exported because the Activity table needs exactly the same
 * derivation for its Status, Duration and Matched-stub columns; deriving it in
 * two places is how the row and the drawer would come to disagree.
 */

import { useNavigate } from 'react-router-dom';

import { type EnvId } from '../lib/environments';
import { hhmm, STATUS_TEXT, statusTone } from '../lib/format';
import { hasUnevaluablePredicate } from '../lib/mb/match';
import { mkCondition, mkPred, mkResp, mkStub } from '../lib/mb/model';
import type { Imposter, RecordedRequest, Resp, Stub } from '../lib/mb/types';
import { respondOf, sigOf, whenOf } from '../lib/summaries';
import {
  Button,
  CodeEditor,
  Drawer,
  Field,
  Icon,
  Off,
  Pill,
  Section,
  Table,
  Verb,
  type PillTone,
} from '../ui';
import styles from './RequestDrawer.module.css';

/* ══════════════════════════════════════════════════════════════
   Derivation — everything the request log does not contain
   ══════════════════════════════════════════════════════════════ */

/** Where a status code came from, since none of them were recorded. */
export type StatusSource =
  /** The matched stub's first `is` response. */
  | 'stub'
  /** No stub matched, so the imposter's default response answered. */
  | 'default'
  /** A proxy or injected response — unknowable without the real traffic. */
  | 'unknown';

export interface DerivedOutcome {
  /** Index of the stub whose predicates the request satisfies, or null. */
  stubIndex: number | null;
  stub: Stub | null;
  /** The response that stub would serve first, or null when nothing matched. */
  response: Resp | null;
  status: number | null;
  statusSource: StatusSource;
  /** Deliberate delay from a `wait` behavior. Real latency was never recorded. */
  waitMs: number;
  /** The stub cycles through several responses, so "the first" is a guess. */
  cycles: boolean;
  /**
   * The verdict rests on a predicate the editor cannot evaluate — either the
   * matched stub itself, or an earlier stub that might have matched first.
   */
  unevaluable: boolean;
}

/** Mountebank's own default when an imposter declares none. */
const MB_DEFAULT_STATUS = 200;

/**
 * The status an unmatched request got. An imposter may set `defaultResponse`;
 * an unparseable draft yields null rather than a confident guess.
 */
function defaultStatus(imposter: Imposter): number | null {
  const text = imposter.defaultResponse.trim();
  if (!text) return MB_DEFAULT_STATUS;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const code = (parsed as { statusCode?: unknown }).statusCode;
      if (typeof code === 'number') return code;
    }
    return MB_DEFAULT_STATUS;
  } catch {
    return null;
  }
}

const waitOf = (response: Resp | null): number => {
  if (!response) return 0;
  const wait = response.behaviors.find((b) => b.type === 'wait');
  return wait === undefined ? 0 : Number(wait.value) || 0;
};

/**
 * Everything the row and the drawer need beyond the raw request. `matchedStubIndex`
 * is already computed by the query layer, so it is read here rather than
 * recomputed — one evaluation per fetch, not one per paint.
 */
export function deriveOutcome(imposter: Imposter, request: RecordedRequest): DerivedOutcome {
  const matched = request.matchedStubIndex;
  const stub = matched === null ? null : (imposter.stubs[matched] ?? null);
  // the stub can go away between the fetch and this paint — then there is no
  // match to report, and every reader must see the same story
  const stubIndex = stub === null ? null : matched;
  const response = stub?.responses[0] ?? null;

  // when nothing matched, ANY stub could have been the one we failed to read
  const candidates = stubIndex === null ? imposter.stubs : imposter.stubs.slice(0, stubIndex + 1);

  let status: number | null;
  let statusSource: StatusSource;

  if (stub === null) {
    status = defaultStatus(imposter);
    statusSource = 'default';
  } else if (response?.type === 'is') {
    status = Number(response.is.statusCode) || MB_DEFAULT_STATUS;
    statusSource = 'stub';
  } else {
    status = null;
    statusSource = 'unknown';
  }

  return {
    stubIndex,
    stub,
    response,
    status,
    statusSource,
    waitMs: waitOf(response),
    cycles: (stub?.responses.length ?? 0) > 1,
    unevaluable: candidates.some(hasUnevaluablePredicate),
  };
}

/** The Pill tone a derived status earns. Unknown gets no opinion. */
export function statusPillTone(status: number | null): PillTone {
  if (status === null) return 'neutral';
  const tone = statusTone(status);
  return tone === '' ? 'neutral' : tone;
}

/** Why the panel believes this status, spelled out per row. */
export const STATUS_SOURCE_NOTE: Record<StatusSource, string> = {
  stub: 'Read from the matched stub’s first response — mountebank did not record what it sent',
  default: 'Nothing matched, so this is the imposter’s default response',
  unknown: 'The matched stub proxies or injects, so the status it returned is not knowable',
};

/** `401 Unauthorized`, or just the number when the code has no name here. */
export const statusLabel = (status: number | null): string => {
  if (status === null) return 'unknown';
  const name = STATUS_TEXT[status];
  return name ? `${status} ${name}` : String(status);
};

/* ══════════════════════════════════════════════════════════════
   A stub prefilled from a request
   ══════════════════════════════════════════════════════════════ */

/**
 * The stub someone would write after seeing this request: one `equals`
 * predicate carrying BOTH method and path — the idiomatic mountebank shape, and
 * the one that does not accidentally match every path — plus a static 200 to
 * edit. Nothing is sent anywhere; this is a draft for the editor.
 */
export function stubFromRequest(request: RecordedRequest): Stub {
  return mkStub({
    predicates: [
      mkPred({
        conditions: [
          mkCondition({ field: 'method', value: request.method || 'GET' }),
          mkCondition({ field: 'path', value: request.path || '/' }),
        ],
      }),
    ],
    responses: [mkResp('is')],
  });
}

/* ══════════════════════════════════════════════════════════════
   Drawer
   ══════════════════════════════════════════════════════════════ */

export interface RequestDrawerProps {
  open: boolean;
  onClose: () => void;
  env: EnvId;
  /** The imposter that received it — the source of every derived value here. */
  imposter: Imposter;
  request: RecordedRequest;
  /**
   * Where "open the matched stub" goes. Without it the drawer follows the app's
   * own URL contract: `/:env/imposters/:port?stub=<index>`.
   */
  onOpenStub?: (imposter: Imposter, stubIndex: number) => void;
  /**
   * Where "create a stub from this request" goes. Without it the drawer follows
   * the URL contract for a new stub — `?new=stub` — and hands the prefilled
   * draft over in router state as `newStub`, so a screen that ignores the state
   * still lands on the right imposter with a blank editor open.
   *
   * Nothing is written to mountebank from here either way: the draft is
   * reviewed and saved in the editor.
   */
  onCreateStub?: (imposter: Imposter, stub: Stub) => void;
}

/** A header or query bag as a two-column table, or an honest "None". */
function KeyValues({ bag, keyHead }: { bag: Record<string, string | string[]>; keyHead: string }) {
  const entries = Object.entries(bag);
  if (!entries.length) return <span className={styles.hint}>None</span>;

  return (
    <Table
      head={
        <tr>
          <th>{keyHead}</th>
          <th>Value</th>
        </tr>
      }
    >
      {entries.map(([key, value]) => (
        <tr key={key}>
          <td className={`mono ${styles.kvKey}`}>{key}</td>
          <td className="mono">{Array.isArray(value) ? value.join(', ') : value}</td>
        </tr>
      ))}
    </Table>
  );
}

export function RequestDrawer({
  open,
  onClose,
  env,
  imposter,
  request,
  onOpenStub,
  onCreateStub,
}: RequestDrawerProps) {
  const navigate = useNavigate();
  const outcome = deriveOutcome(imposter, request);
  const { stub, stubIndex, response } = outcome;

  const imposterPath = `/${env}/imposters/${imposter.port}`;

  function openStub(): void {
    if (stubIndex === null) return;
    if (onOpenStub) {
      onOpenStub(imposter, stubIndex);
      return;
    }
    void navigate(`${imposterPath}?stub=${stubIndex}`);
  }

  function createStub(): void {
    const draft = stubFromRequest(request);
    if (onCreateStub) {
      onCreateStub(imposter, draft);
      return;
    }
    void navigate(`${imposterPath}?new=stub`, { state: { newStub: draft } });
  }

  /** `note` becomes the cell's tooltip, which is where "derived" is spelled out. */
  const meta: Array<{ label: string; value: string; note?: string }> = [
    { label: 'Imposter', value: imposter.name || `port ${imposter.port}` },
    { label: 'Port', value: String(imposter.port) },
    {
      label: 'Status',
      value: outcome.status === null ? 'unknown' : String(outcome.status),
      note: STATUS_SOURCE_NOTE[outcome.statusSource],
    },
    {
      label: 'Duration',
      value: outcome.waitMs > 0 ? `${outcome.waitMs} ms wait` : 'no delay',
      note: 'Mountebank does not time its responses — this is the wait behavior on the matched stub',
    },
    { label: 'Received', value: request.timestamp ? hhmm(request.timestamp) : 'unknown' },
    {
      label: 'Matched',
      value: stubIndex === null ? 'none' : `#${stubIndex + 1}`,
      note: 'Computed by evaluating predicates — mountebank does not report the match',
    },
  ];

  const signature = stub ? sigOf(stub) : null;
  const isStatic = response?.type === 'is';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Request"
      subtitle={`${request.method} ${request.path}`}
      tools={<Pill tone={statusPillTone(outcome.status)}>{statusLabel(outcome.status)}</Pill>}
      footer={
        <>
          <span className="lbl">From mountebank&apos;s own request log</span>
          <div className={styles.spacer} />
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className={styles.metaGrid}>
        {meta.map((cell) => (
          <div className={styles.meta} key={cell.label} title={cell.note}>
            <div className="lbl">{cell.label}</div>
            <div className={styles.metaValue}>{cell.value}</div>
          </div>
        ))}
      </div>

      <Section
        title={stub ? 'Matched stub' : 'No stub matched'}
        icon={<Icon name={stub ? 'check' : 'alert'} />}
        badge={
          outcome.unevaluable ? (
            <Pill tone="warn" dot>
              unconfirmed
            </Pill>
          ) : (
            <Pill tone="acc">computed</Pill>
          )
        }
      >
        {stub && signature ? (
          <>
            <button type="button" className={styles.stub} onClick={openStub}>
              <span className={styles.stubOrd}>{(stubIndex ?? 0) + 1}</span>
              <span className={styles.stubMain}>
                <span className={styles.stubSig}>
                  <Verb method={signature.method} />
                  <span className={styles.stubPath}>{signature.path}</span>
                </span>
                <span className={styles.ledger}>
                  <span className="lbl">When</span>
                  <span className={styles.ledgerValue}>{whenOf(stub)}</span>
                  <span className="lbl">Respond</span>
                  <span className={styles.ledgerValue}>{respondOf(stub)}</span>
                </span>
              </span>
              <span className={styles.stubAside}>
                <Pill tone="acc">open editor</Pill>
              </span>
            </button>

            <p className={styles.hint}>
              Mountebank only reports the matching stub when it runs with{' '}
              <span className="mono">--debug</span>, which it does not here. This match was computed
              by evaluating the predicates the way mountebank does — first stub whose predicates all
              hold.
            </p>

            {outcome.unevaluable ? (
              <p className={styles.warnLine}>
                <Icon name="alert" />
                <span>
                  A stub at or before this one carries a predicate the editor cannot model, so this
                  match is <Off>unconfirmed</Off>.
                </span>
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className={styles.errLine}>
              <Icon name="alert" />
              <span>
                No stub matched, so the default response was used. Create a stub for this path to
                take control of it.
              </span>
            </p>

            <div>
              <Button
                variant="primary"
                size="sm"
                icon={<Icon name="plus" />}
                onClick={createStub}
                title="Open the stub editor with this request filled in"
              >
                Create stub from this request
              </Button>
            </div>

            <p className={styles.hint}>
              Opens the editor with one equals predicate on this method and path, and a static 200 to
              fill in. Nothing is sent to mountebank until you save it.
            </p>

            {outcome.unevaluable ? (
              <p className={styles.warnLine}>
                <Icon name="alert" />
                <span>
                  One of this imposter&apos;s stubs carries a predicate the editor cannot model, so
                  &ldquo;no match&rdquo; is <Off>unconfirmed</Off> — mountebank may well have
                  answered from it.
                </span>
              </p>
            ) : null}
          </>
        )}
      </Section>

      <Section title="Request" icon={<Icon name="reqs" />}>
        <Field label="Headers">
          <KeyValues bag={request.headers} keyHead="Header" />
        </Field>
        <Field label="Query">
          <KeyValues bag={request.query} keyHead="Parameter" />
        </Field>
        <Field label="Body">
          {request.body ? (
            <CodeEditor value={request.body} language="json" height={170} readOnly />
          ) : (
            <span className={styles.hint}>Empty</span>
          )}
        </Field>
      </Section>

      <Section
        title="Response"
        icon={<Icon name="code" />}
        badge={<Pill tone="warn">derived</Pill>}
      >
        <p className={styles.hint}>
          Mountebank stores requests, never the responses it sent. What follows is read from the
          matched stub — what it <em>would</em> return — not a recording of what went back.
        </p>

        {stub === null ? (
          <p className={styles.hint}>
            Nothing matched, so this request was answered by{' '}
            {imposter.defaultResponse.trim()
              ? "the imposter's own default response"
              : `mountebank's default — ${MB_DEFAULT_STATUS} with an empty body`}
            . There is no stub to read a body from.
          </p>
        ) : response === null ? (
          <p className={styles.hint}>The matched stub declares no response.</p>
        ) : isStatic ? (
          <>
            {outcome.cycles ? (
              <p className={styles.warnLine}>
                <Icon name="alert" />
                <span>
                  This stub cycles through {stub.responses.length} responses, so which one served
                  this request is not knowable. The first is shown.
                </span>
              </p>
            ) : null}
            <Field label="Status">
              <div>
                <Pill tone={statusPillTone(outcome.status)}>{statusLabel(outcome.status)}</Pill>
              </div>
            </Field>
            <Field label="Headers">
              <KeyValues bag={response.is.headers} keyHead="Header" />
            </Field>
            <Field label="Body">
              {response.is.body ? (
                <CodeEditor value={response.is.body} language="json" height={190} readOnly />
              ) : (
                <span className={styles.hint}>Empty</span>
              )}
            </Field>
          </>
        ) : response.type === 'proxy' ? (
          <p className={styles.hint}>
            The matched stub proxies to <span className="mono">{response.proxy.to}</span> in{' '}
            <span className="mono">{response.proxy.mode}</span> mode. The real service produced the
            response, and mountebank kept no copy of it — nothing can be reconstructed here.
          </p>
        ) : (
          <>
            <p className={styles.hint}>
              The matched stub answers from injected JavaScript, so the response depended on the
              request and on mountebank&apos;s state at the time. The source is shown; the output is
              not recoverable.
            </p>
            <CodeEditor value={response.inject} language="js" height={200} readOnly />
          </>
        )}
      </Section>
    </Drawer>
  );
}
