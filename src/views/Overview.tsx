/**
 * Overview — the workspace at a glance.
 *
 * Head, then a standing explanation of what an imposter and a stub are, then
 * four counts, the imposter table, and what this panel has done.
 *
 * Four things this screen is deliberate about:
 *
 *  1. THE HEAD IS ALMOST EMPTY. Environment label, "Workspace", nothing else.
 *     The admin API URL reads in the sidebar's Connections card and again on
 *     Settings; a third copy here was clutter, and the state recap that used to
 *     sit under the title said nothing the tiles do not say better.
 *
 *  2. NOTHING IS HARDCODED. Every count is derived, and every pill is a claim
 *     that was actually checked — "all answering stubs" and "every request
 *     matched" are never asserted without the check behind them. A number the
 *     queries have not returned yet reads as '…', never as a confident 0.
 *
 *  3. STUB MATCHING IS OURS, not Mountebank's. The admin API only reports which
 *     stub answered when the instance was started with `--debug`, which is not
 *     the default. The panel computes it (`findMatchingStub`), and the Unmatched
 *     tile says so.
 *
 *  4. REQUEST LOGS ARE PER IMPOSTER. `GET /imposters?replayable=true` returns
 *     stubs but no traffic, so the captured-request and unmatched numbers need
 *     one read per port. `useImposter` is per-imposter and the port list is
 *     data, so those reads cannot come from a loop — each port gets a probe
 *     component that renders nothing and reports upward.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { type EnvId } from '../lib/environments';
import { envOr } from '../store/useEnvironments';
import { ago, hhmm, plural } from '../lib/format';
import { imposterFromMb, imposterToMb } from '../lib/mb/model';
import type { Imposter, RecordedRequest } from '../lib/mb/types';
import { useCreateImposter, useDeleteImposter, useImposter, useImposters } from '../lib/queries';
import { sigOf } from '../lib/summaries';
import { useStudio } from '../store/useStudio';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  Modal,
  Off,
  PageHead,
  Pill,
  Strip,
  Table,
  Verb,
} from '../ui';
import { Failure } from './Failure';
import styles from './Overview.module.css';

/* ══════════════════════════════════════════════════════════════
   Ports

   Where this workspace's imposters start, and the first port a
   duplicate can claim. Mountebank can still refuse it because
   something else on the host is listening, which is why a failed
   write surfaces as a toast rather than being predicted here.
   ══════════════════════════════════════════════════════════════ */

const FIRST_PORT = 4545;
const LAST_PORT = 65_535;

function nextFreePort(taken: number[]): number {
  const used = new Set(taken);
  let port = FIRST_PORT;
  while (port < LAST_PORT && used.has(port)) port += 1;
  return port;
}

/* ══════════════════════════════════════════════════════════════
   Traffic fan-out

   One `useImposter` per port. The hook is per-imposter and the port
   list is data, so the calls cannot be made from a loop in the page
   component — each port gets a probe component instead, which renders
   nothing and reports its result upward.
   ══════════════════════════════════════════════════════════════ */

type ProbeStatus = 'loading' | 'ready' | 'error';

interface PortTraffic {
  env: EnvId;
  port: number;
  status: ProbeStatus;
  requests: RecordedRequest[];
}

interface TrafficProbeProps {
  env: EnvId;
  port: number;
  onReport: (entry: PortTraffic) => void;
}

/**
 * One read of one imposter's request log. Renders nothing: its whole job is to
 * hold a query for a port the page only learned about at runtime.
 *
 * `requests` comes straight off the query cache, so its identity only changes
 * when the data does — that is what keeps the report effect from looping.
 */
function TrafficProbe({ env, port, onReport }: TrafficProbeProps) {
  const query = useImposter(env, port);
  const status: ProbeStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready';
  const requests = query.data?.requests;

  useEffect(() => {
    onReport({ env, port, status, requests: requests ?? [] });
  }, [onReport, env, port, status, requests]);

  return null;
}

interface Traffic {
  /** Mount these somewhere in the tree — they are the reads. */
  probes: ReactNode;
  byPort: Map<number, PortTraffic>;
  /** Every request from every port that answered. Partial while probes land. */
  requests: RecordedRequest[];
  /** At least one port has not reported yet, so the totals are incomplete. */
  loading: boolean;
  /** How many ports refused their log. */
  failed: number;
}

function useTraffic(env: EnvId, ports: number[]): Traffic {
  const [reports, setReports] = useState<PortTraffic[]>([]);

  const report = useCallback((entry: PortTraffic): void => {
    setReports((prev) => {
      // a report from another environment means the switch already happened,
      // so the previous environment's numbers are dropped rather than mixed in
      const kept = prev.filter((p) => p.env === entry.env);
      const at = kept.findIndex((p) => p.port === entry.port);
      if (at === -1) return [...kept, entry];

      const held = kept[at];
      const unchanged =
        kept.length === prev.length &&
        held.status === entry.status &&
        held.requests === entry.requests;
      if (unchanged) return prev;

      const next = kept.slice();
      next[at] = entry;
      return next;
    });
  }, []);

  const byPort = useMemo(() => {
    const wanted = new Set(ports);
    const map = new Map<number, PortTraffic>();
    for (const entry of reports) {
      if (entry.env === env && wanted.has(entry.port)) map.set(entry.port, entry);
    }
    return map;
  }, [reports, env, ports]);

  const requests = useMemo(() => {
    const flat: RecordedRequest[] = [];
    for (const entry of byPort.values()) {
      if (entry.status === 'ready') flat.push(...entry.requests);
    }
    return flat;
  }, [byPort]);

  const loading = ports.some((port) => (byPort.get(port)?.status ?? 'loading') === 'loading');
  const failed = ports.reduce((n, port) => n + (byPort.get(port)?.status === 'error' ? 1 : 0), 0);

  const probes = ports.map((port) => (
    <TrafficProbe key={`${env}:${port}`} env={env} port={port} onReport={report} />
  ));

  return { probes, byPort, requests, loading, failed };
}

/* ══════════════════════════════════════════════════════════════
   Tiles and feed rows
   ══════════════════════════════════════════════════════════════ */

interface StatProps {
  /** A node, not a number, so a count we do not have yet can read as '…'. */
  value: ReactNode;
  label: string;
  /** The line under the rule: pills and plain facts, all of them checked. */
  meta?: ReactNode;
}

function Stat({ value, label, meta }: StatProps) {
  return (
    <div className={styles.stat}>
      <div className={styles.statV}>{value}</div>
      <div className={styles.statL}>{label}</div>
      {meta !== undefined ? <div className={styles.statMeta}>{meta}</div> : null}
    </div>
  );
}

/** The dot is colour only, so the level ships as text for screen readers too. */

function Ev({ port, request }: { port: number; request: RecordedRequest }) {
  const matched = request.matchedStubIndex !== null;
  return (
    <div className={styles.ev}>
      <span
        className={`${styles.evDot} ${matched ? styles.lvlOk : styles.lvlWarn}`}
        aria-hidden="true"
      />
      <span className={styles.evTime}>{hhmm(request.timestamp)}</span>
      <span className={styles.evMsg}>
        <span className={styles.sr}>{matched ? 'matched' : 'no matching stub'}: </span>
        <Verb method={request.method} /> <code>{request.path}</code>
        {matched ? null : (
          <>
            {' '}
            <Off>no matching stub</Off>
          </>
        )}
      </span>
      <span className={styles.evSrc}>port {port}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   The screen
   ══════════════════════════════════════════════════════════════ */

export function Overview() {
  const navigate = useNavigate();
  const params = useParams();
  const storedEnv = useStudio((s) => s.env);

  // the URL wins when it names a real environment; otherwise the store does
  const environment = envOr(params.env ?? storedEnv);
  const env = environment.id;

  const imposters = useImposters(env);

  const list = useMemo(() => imposters.data ?? [], [imposters.data]);
  const ports = useMemo(() => list.map((imposter) => imposter.port), [list]);
  const traffic = useTraffic(env, ports);

  const createImposter = useCreateImposter(env);
  const deleteImposter = useDeleteImposter(env);
  const busy = createImposter.isPending || deleteImposter.isPending;

  const [pendingDuplicate, setPendingDuplicate] = useState<Imposter | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Imposter | null>(null);

  /* ---------- everything the page says, derived once ---------- */

  const stubCount = list.reduce((total, imposter) => total + imposter.stubs.length, 0);
  const pathCount = new Set(
    list.flatMap((imposter) => imposter.stubs.map((stub) => sigOf(stub).path)),
  ).size;
  const recording = list.filter((imposter) => imposter.recordRequests).length;
  const withoutStubs = list.filter((imposter) => imposter.stubs.length === 0).length;

  const unmatched = traffic.requests.filter((r) => r.matchedStubIndex === null).length;
  const lastSeen = traffic.requests.length
    ? ago(Math.max(...traffic.requests.map((r) => r.timestamp)))
    : 'never';

  /** The five newest things this panel did. The store is already newest-first. */
  /** The five newest requests across every port, for the Activity preview card. */
  const recent = useMemo(() => {
    const rows: { key: string; port: number; request: RecordedRequest }[] = [];
    for (const [port, entry] of traffic.byPort) {
      for (const request of entry.requests)
        rows.push({ key: `${port}:${request.id}`, port, request });
    }
    return rows.sort((a, b) => b.request.timestamp - a.request.timestamp).slice(0, 5);
  }, [traffic.byPort]);

  const loadingList = imposters.isPending;
  const listFailed = imposters.isError;

  /* ---------- write actions ---------- */

  const freePort = nextFreePort(ports);

  const confirmDuplicate = (): void => {
    const source = pendingDuplicate;
    setPendingDuplicate(null);
    if (source === null) return;

    // the wire round-trip is the deep clone: toMb drops every UI id and the
    // captured-request count, fromMb mints fresh ids, so the copy shares no
    // identity with its source
    const clone = imposterFromMb(imposterToMb(source));
    const name = `${source.name}-copy`;
    createImposter.mutate({ ...clone, name, port: freePort });
  };

  const confirmDelete = (): void => {
    const doomed = pendingDelete;
    setPendingDelete(null);
    if (doomed === null) return;

    deleteImposter.mutate({ port: doomed.port, name: doomed.name });
  };

  /** Only a port that actually answered can say how much traffic it will lose. */
  const doomedRequests = ((): number | undefined => {
    if (pendingDelete === null) return undefined;
    const entry = traffic.byPort.get(pendingDelete.port);
    return entry?.status === 'ready' ? entry.requests.length : undefined;
  })();

  /* ---------- tiles ---------- */

  const unknownTraffic = traffic.loading;

  const runningMeta =
    list.length === 0 ? (
      <Pill dot>nothing running</Pill>
    ) : withoutStubs ? (
      <Pill tone="warn" dot>
        {withoutStubs} with no stubs
      </Pill>
    ) : (
      <Pill tone="ok" dot>
        all answering stubs
      </Pill>
    );

  const stubsMeta =
    list.length === 0 ? (
      <Pill dot>nothing defined yet</Pill>
    ) : stubCount === 0 ? (
      <Pill tone="warn" dot>
        no stubs anywhere
      </Pill>
    ) : (
      <span>{plural(pathCount, 'distinct path')}</span>
    );

  const capturedMeta = unknownTraffic ? (
    <span>reading the request logs…</span>
  ) : traffic.failed ? (
    <Pill tone="err" dot>
      {plural(traffic.failed, 'log')} unreadable
    </Pill>
  ) : traffic.requests.length ? (
    <span>last {lastSeen}</span>
  ) : recording === 0 && list.length > 0 ? (
    <Pill tone="warn" dot>
      recording is off
    </Pill>
  ) : (
    <Pill dot>nothing captured yet</Pill>
  );

  const unmatchedMeta = unknownTraffic ? (
    <span>still counting</span>
  ) : unmatched ? (
    <Pill tone="err" dot>
      needs a stub
    </Pill>
  ) : traffic.requests.length ? (
    <Pill tone="ok" dot>
      every request matched
    </Pill>
  ) : (
    <Pill dot>nothing captured yet</Pill>
  );

  /* ---------- rows ---------- */

  const imposterRow = (imposter: Imposter): ReactNode => {
    const detail = `/${env}/imposters/${imposter.port}`;
    const entry = traffic.byPort.get(imposter.port);
    const requestCell =
      entry === undefined || entry.status === 'loading' ? (
        <span className={styles.dim}>…</span>
      ) : entry.status === 'error' ? (
        <span className={styles.dim} title="This imposter's request log could not be read.">
          —
        </span>
      ) : (
        entry.requests.length
      );

    return (
      <tr key={imposter.port} className="click" onClick={() => void navigate(detail)}>
        <td>
          <div className="imp-name">
            {/* mountebank only lists what it is actually serving */}
            <Pill tone="ok" dot>
              Running
            </Pill>
            <Link
              className={styles.impLink}
              to={detail}
              onClick={(e) => e.stopPropagation()}
              title={`Open ${imposter.name}`}
            >
              <b>{imposter.name}</b>
            </Link>
          </div>
        </td>
        <td className="mono num">{imposter.port}</td>
        <td>
          <Pill>{imposter.protocol}</Pill>
        </td>
        <td className="mono num">{imposter.stubs.length}</td>
        <td className="mono num">{requestCell}</td>
        <td>
          {imposter.recordRequests ? (
            <Pill tone="acc" dot>
              on
            </Pill>
          ) : (
            <Pill>off</Pill>
          )}
        </td>
        <td>
          <div className="row-acts">
            <Button
              variant="ghost"
              iconOnly
              icon={<Icon name="copy" />}
              disabled={busy}
              title="Duplicate"
              aria-label={`Duplicate ${imposter.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setPendingDuplicate(imposter);
              }}
            />
            <Button
              variant="ghost"
              iconOnly
              icon={<Icon name="trash" />}
              className="btn--danger"
              disabled={busy}
              title="Delete"
              aria-label={`Delete ${imposter.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setPendingDelete(imposter);
              }}
            />
          </div>
        </td>
      </tr>
    );
  };

  /* ---------- render ---------- */

  return (
    <>
      {traffic.probes}

      <PageHead eyebrow={environment.label} title="Workspace" />

      <Strip tone="info" icon={<Icon name="file" />} title="How a mock is put together">
        An <b>imposter</b> is one mock server on one port — point a service at that port and it
        talks to this panel instead of the real service. Inside it, each <b>stub</b> says{' '}
        <em>when</em> it applies and <em>what</em> to answer. Stubs are matched top to bottom, so
        the first one whose conditions fit wins and the rest never see the request.
      </Strip>

      {environment.note !== undefined && environment.note !== '' ? (
        <Strip tone="warn" icon={<Icon name="alert" />} title={environment.label}>
          {environment.note}
        </Strip>
      ) : null}

      {listFailed ? (
        <Strip
          tone="err"
          icon={<Icon name="alert" />}
          title="Could not read the imposters"
          actions={
            <Button size="sm" onClick={() => void imposters.refetch()}>
              Try again
            </Button>
          }
        >
          <Failure target={environment.target} error={imposters.error} />
        </Strip>
      ) : null}

      {loadingList ? (
        <Strip icon={<Icon name="clock" />} title={`Reading ${environment.label}`}>
          Asking {environment.target} which imposters it is running.
        </Strip>
      ) : null}

      {!loadingList && !listFailed ? (
        <>
          <div className={styles.stats}>
            <Stat
              value={list.length}
              label="Imposters running"
              meta={
                <>
                  {runningMeta}
                  <span>the admin API lists only live ones</span>
                </>
              }
            />
            <Stat value={stubCount} label="Stubs defined" meta={stubsMeta} />
            <Stat
              value={
                unknownTraffic ? <span className={styles.dim}>…</span> : traffic.requests.length
              }
              label="Requests captured"
              meta={capturedMeta}
            />
            <Stat
              value={
                unknownTraffic ? (
                  <span className={styles.dim}>…</span>
                ) : unmatched ? (
                  <Off>{unmatched}</Off>
                ) : (
                  0
                )
              }
              label="Unmatched"
              meta={
                <>
                  {unmatchedMeta}
                  <span>computed here</span>
                </>
              }
            />
          </div>

          <div className={styles.gap}>
            {list.length ? (
              <Card
                title="Imposters"
                flush
                actions={
                  <Button
                    size="sm"
                    icon={<Icon name="chev" size={14} />}
                    onClick={() => void navigate(`/${env}/imposters`)}
                  >
                    Manage
                  </Button>
                }
              >
                <Table
                  head={
                    <tr>
                      <th>Imposter</th>
                      <th>Port</th>
                      <th>Protocol</th>
                      <th>Stubs</th>
                      <th>Requests</th>
                      <th>Recording</th>
                      <th aria-label="Row actions" />
                    </tr>
                  }
                >
                  {list.map(imposterRow)}
                </Table>
              </Card>
            ) : (
              <Card title="Imposters">
                <EmptyState
                  title="No imposters yet"
                  action={
                    <Button
                      icon={<Icon name="chev" size={14} />}
                      onClick={() => void navigate(`/${env}/imposters`)}
                    >
                      Open Imposters
                    </Button>
                  }
                >
                  An imposter is one mock server on one port. The Imposters screen is where one is
                  created, and then stubs decide what it answers.
                </EmptyState>
              </Card>
            )}
          </div>

          <Card
            title="Recent activity"
            actions={
              <Button
                size="sm"
                icon={<Icon name="chev" size={14} />}
                onClick={() => void navigate(`/${env}/activity`)}
              >
                Full Log
              </Button>
            }
          >
            {recent.length ? (
              <>
                <div className={styles.feed}>
                  {recent.map((row) => (
                    <Ev key={row.key} port={row.port} request={row.request} />
                  ))}
                </div>
                <p className={styles.footnote}>
                  Whether a stub matched is computed here by evaluating its predicates — Mountebank
                  only reports it when run with <code>--debug</code>.
                </p>
              </>
            ) : (
              <div className={styles.feedEmpty}>
                <p>
                  Nothing captured yet. Send a request to one of these ports and it appears here and
                  on the Activity screen.
                </p>
              </div>
            )}
          </Card>
        </>
      ) : null}

      <Modal
        open={pendingDuplicate !== null}
        onClose={() => setPendingDuplicate(null)}
        title={pendingDuplicate ? `Duplicate ${pendingDuplicate.name}?` : 'Duplicate imposter?'}
        subtitle={`A copy starts answering on port ${freePort} in ${environment.label}.`}
        footer={
          <>
            <Button onClick={() => setPendingDuplicate(null)}>Cancel</Button>
            <Button
              variant="primary"
              icon={<Icon name="copy" size={14} />}
              disabled={createImposter.isPending}
              title="Duplicate Imposter"
              onClick={confirmDuplicate}
            >
              Duplicate imposter
            </Button>
          </>
        }
      >
        <p className={styles.modalNote}>
          {pendingDuplicate ? plural(pendingDuplicate.stubs.length, 'stub') : 'Every stub'} is
          copied as it stands. Captured requests are not — the copy starts with an empty log.
        </p>
      </Modal>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : 'Delete imposter?'}
        subtitle={
          pendingDelete
            ? `Port ${pendingDelete.port} in ${environment.label} is freed immediately.`
            : undefined
        }
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)}>Keep It</Button>
            <Button
              variant="danger"
              icon={<Icon name="trash" size={14} />}
              disabled={deleteImposter.isPending}
              title="Delete Imposter"
              onClick={confirmDelete}
            >
              Delete imposter
            </Button>
          </>
        }
      >
        <p className={styles.modalNote}>
          {pendingDelete ? plural(pendingDelete.stubs.length, 'stub') : 'Its stubs'} and{' '}
          {doomedRequests === undefined
            ? 'any captured requests'
            : plural(doomedRequests, 'captured request')}{' '}
          go with it. This can&rsquo;t be undone.
        </p>
      </Modal>
    </>
  );
}

export default Overview;
