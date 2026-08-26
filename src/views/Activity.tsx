/**
 * Captured traffic, across every imposter in the environment.
 *
 * Three things about mountebank shape this screen, and the standing info strip
 * under the head says all three out loud rather than presenting a tidy fiction:
 *
 *  • There is no cross-imposter request log. Traffic lives on each imposter, so
 *    this screen fans out over the ports and merges the results newest-first.
 *  • Mountebank does not report which stub answered a request unless it runs
 *    with `--debug` (it does not here), so the match is COMPUTED from the
 *    predicates and labelled as computed.
 *  • Mountebank never stores the response it sent, so Status and Duration are
 *    read from the matched stub — a derivation, not a recording.
 *
 * The derivation itself lives in RequestDrawer.tsx so the row and the detail
 * view can never disagree about what a request got back.
 */

import { useEffect, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { type EnvId } from '../lib/environments';
import { envOr } from '../store/useEnvironments';
import { ago, hhmm, plural } from '../lib/format';
import { getImposter } from '../lib/mb/client';
import { findMatchingStub } from '../lib/mb/match';
import { imposterFromMb, pretty } from '../lib/mb/model';
import type { Imposter, MbRecordedRequest, RecordedRequest } from '../lib/mb/types';
import { useInstanceFacts, whyMatchIsComputed, matchSource } from '../lib/mb/instanceFacts';
import { mbKeys, useImposters, type ImposterDetail } from '../lib/queries';
import { sigOf } from '../lib/summaries';
import { Failure } from './Failure';
import { useStudio } from '../store/useStudio';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  Off,
  PageHead,
  Pill,
  Seg,
  Strip,
  Table,
  Verb,
  type SegOption,
} from '../ui';
import {
  deriveOutcome,
  statusLabel,
  statusPillTone,
  RequestDrawer,
  statusSourceNote,
  type DerivedOutcome,
} from './RequestDrawer';
import styles from './Activity.module.css';

/* ══════════════════════════════════════════════════════════════
   Fetching traffic for every imposter at once
   ══════════════════════════════════════════════════════════════ */

/** A body is always held as text so a non-JSON payload survives untouched. */
const bodyText = (body: unknown): string => {
  if (body === undefined || body === null) return '';
  return typeof body === 'string' ? body : pretty(body);
};

/** An absent or unparseable timestamp becomes 0 rather than "now". */
function epochMs(timestamp: string | undefined): number {
  if (!timestamp) return 0;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * `useImposter` covers one port, and hooks cannot be called in a loop, so this
 * screen fans out with `useQueries` instead.
 *
 * It deliberately uses the SAME query key (`mbKeys.imposter`) and produces the
 * same `ImposterDetail` shape, so one cache entry per port is shared with the
 * imposter screen: opening an imposter after visiting this page costs nothing,
 * and a mutation that invalidates `mbKeys.imposter` refreshes this table too.
 */
async function fetchTraffic(env: EnvId, port: number): Promise<ImposterDetail> {
  const raw = await getImposter(env, port);
  const imposter = imposterFromMb(raw);
  const recorded: MbRecordedRequest[] = raw.requests ?? [];

  const requests = recorded.map((r, index): RecordedRequest => ({
    // requests are append-only, so index + arrival time is a stable identity
    id: `req_${port}_${index}_${r.timestamp ?? 'na'}`,
    method: (r.method ?? '').toUpperCase(),
    path: r.path ?? '',
    query: r.query ?? {},
    headers: r.headers ?? {},
    body: bodyText(r.body),
    timestamp: epochMs(r.timestamp),
    matchedStubIndex: findMatchingStub(r, imposter.stubs),
  }));

  return { imposter, requests };
}

/* ══════════════════════════════════════════════════════════════
   Rows and filters
   ══════════════════════════════════════════════════════════════ */

interface Row {
  request: RecordedRequest;
  imposter: Imposter;
  outcome: DerivedOutcome;
}

type Filter = 'all' | 'unmatched' | 'errors';

function rowMatches(row: Row, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'unmatched') return row.outcome.stubIndex === null;
  return row.outcome.status !== null && row.outcome.status >= 400;
}

/**
 * The standing explanation of the screen: how a log with no responses in it can
 * still show a status and a matched stub.
 *
 * It used to state, flatly, that mountebank does not store the response it sent — while
 * conditioning the missing MATCH on `--debug` in the same sentence. Both come from the
 * same flag: a --debug instance records the response, the processing time and the match
 * in each stub's `matches`. The panel does not read that, which is a different sentence
 * and now told as one. See src/lib/mb/instanceFacts.ts.
 */
function HowToRead({ env }: { env: EnvId }) {
  const facts = useInstanceFacts(env);
  return (
    <Strip tone="info" icon={<Icon name="reqs" />} title="How to read this log">
      {whyMatchIsComputed(facts)} First match wins, exactly as Mountebank resolves a request.
    </Strip>
  );
}

/* ══════════════════════════════════════════════════════════════
   Screen
   ══════════════════════════════════════════════════════════════ */

/** Which request the drawer is showing. Held by identity, not by object. */
interface Selection {
  port: number;
  requestId: string;
}

/** Long enough for the drawer's exit transition to finish. */
const DRAWER_EXIT_MS = 300;

export function Activity() {
  const params = useParams<{ env?: string }>();
  const storeEnv = useStudio((s) => s.env);
  // the URL wins — a link must land whoever opens it in the right environment
  const environment = envOr(params.env ?? storeEnv);
  const env = environment.id;

  const [filter, setFilter] = useState<Filter>('all');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const navigate = useNavigate();
  const impostersQuery = useImposters(env);
  const imposters = impostersQuery.data ?? [];
  /* What this instance keeps and reports, read from it — the facts every sentence on
     this screen about mountebank's own records depends on. */
  const facts = useInstanceFacts(env);
  const recording = imposters.filter((imposter) => imposter.recordRequests).length;

  // a port is an imposter's identity, so a non-port is not worth a request
  const ports = imposters
    .map((imposter) => imposter.port)
    .filter((port) => Number.isFinite(port) && port > 0);

  const details = useQueries({
    queries: ports.map((port) => ({
      queryKey: mbKeys.imposter(env, port),
      queryFn: () => fetchTraffic(env, port),
      staleTime: 2_000,
    })),
  });

  const loadedDetails = details.flatMap((q) => (q.data ? [q.data] : []));
  const pendingCount = details.filter((q) => q.isPending).length;
  const failed = details.flatMap((q) => (q.error ? [q.error] : []));

  /**
   * Every request from every imposter, newest first. Derived on each render
   * rather than memoised: `deriveOutcome` is a handful of comparisons per row,
   * and a stale memo here would show a match computed against stubs that have
   * since been edited.
   */
  const rows: Row[] = loadedDetails
    .flatMap((detail) =>
      detail.requests.map((request): Row => ({
        request,
        imposter: detail.imposter,
        outcome: deriveOutcome(detail.imposter, request),
      })),
    )
    .sort((a, b) => b.request.timestamp - a.request.timestamp);

  const shown = rows.filter((row) => rowMatches(row, filter));

  const filters: SegOption<Filter>[] = [
    { value: 'all', label: 'All' },
    { value: 'unmatched', label: 'Unmatched' },
    { value: 'errors', label: 'Errors' },
  ];

  const selectedRow =
    selection === null
      ? undefined
      : rows.find(
          (row) => row.imposter.port === selection.port && row.request.id === selection.requestId,
        );

  function openRow(row: Row): void {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setSelection({ port: row.imposter.port, requestId: row.request.id });
    setDrawerOpen(true);
  }

  function closeDrawer(): void {
    setDrawerOpen(false);
    closeTimer.current = window.setTimeout(() => {
      setSelection(null);
      closeTimer.current = null;
    }, DRAWER_EXIT_MS);
  }

  function refreshAll(): void {
    void impostersQuery.refetch();
    for (const detail of details) void detail.refetch();
  }

  /* ────────────────────────────  loading / error  ───────────────────────── */

  if (impostersQuery.isPending) {
    return (
      <>
        <PageHead title="Activity" />
        <HowToRead env={env} />
        <Card>
          <p className={styles.state}>
            <Icon name="clock" />
            Loading imposters from {environment.label}…
          </p>
        </Card>
      </>
    );
  }

  if (impostersQuery.isError) {
    return (
      <>
        <PageHead title="Activity" />
        <HowToRead env={env} />
        <Card title="Could not reach Mountebank">
          {/*
           * A column, not a paragraph followed by a loose button: the cause is a long
           * sentence that carries a command, so the button has to sit BELOW it on its
           * own line. Left inline, it wrapped to the next line by itself and dragged
           * the card's height around as the text reflowed.
           */}
          <div className={styles.errBlock}>
            <p className={styles.errState}>
              <Icon name="alert" />
              {/*
               * The span matters: this paragraph is a flex row, and without it every
               * text run and the command chip become separate flex items — which
               * squeezed the command into a four-line column at the card's edge.
               */}
              <span>
                <Failure target={environment.target} error={impostersQuery.error} />
              </span>
            </p>
            <div className={styles.errActions}>
              <Button icon={<Icon name="bolt" />} onClick={() => void impostersQuery.refetch()}>
                Try Again
              </Button>
            </div>
          </div>
        </Card>
      </>
    );
  }

  /* ────────────────────────────────  screen  ────────────────────────────── */

  return (
    <>
      <PageHead
        title="Activity"
        tools={
          <Button
            icon={<Icon name="bolt" />}
            onClick={refreshAll}
            disabled={impostersQuery.isFetching || pendingCount > 0}
            title="Re-read the request log from every imposter"
          >
            Refresh
          </Button>
        }
      />

      <HowToRead env={env} />

      {imposters.length === 0 ? (
        <EmptyState
          title="No imposters in this environment"
          action={
            <Button
              variant="primary"
              icon={<Icon name="imps" />}
              onClick={() => void navigate(`/${env}/imposters`)}
            >
              Go to imposters
            </Button>
          }
        >
          No imposters here yet — nothing in {environment.label} is listening for traffic.
        </EmptyState>
      ) : (
        <>
          {pendingCount > 0 || failed.length > 0 ? (
            <div className={styles.progress}>
              {pendingCount > 0 ? (
                <p className={styles.state}>
                  <Icon name="clock" />
                  Still reading the request log from {pendingCount} of{' '}
                  {plural(ports.length, 'imposter')}…
                </p>
              ) : null}
              {failed.length > 0 ? (
                <p className={styles.errState}>
                  <Icon name="alert" />
                  <span>
                    {plural(failed.length, 'imposter')} did not answer:{' '}
                    <Failure target={environment.target} error={failed[0]} />
                    {failed.length > 1 ? ' (and others)' : ''} — the table below is incomplete.
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}

          <div className={styles.toolbar}>
            <Seg<Filter>
              value={filter}
              onChange={setFilter}
              options={filters}
              label="Filter captured requests"
            />
            <div className={styles.spacer} />
            <span className="lbl">{plural(shown.length, 'request')}</span>
          </div>

          {shown.length > 0 ? (
            <Card flush>
              <Table
                head={
                  <tr>
                    <th>Method</th>
                    <th>Path</th>
                    <th>Imposter</th>
                    <th title={matchSource(facts)}>Status</th>
                    <th title={matchSource(facts)}>Duration</th>
                    <th title={matchSource(facts)}>Matched stub</th>
                    <th>When</th>
                  </tr>
                }
              >
                {shown.map((row) => (
                  <RequestRow
                    key={row.request.id}
                    row={row}
                    onOpen={openRow}
                    reportsMatches={facts.reportsMatches}
                  />
                ))}
              </Table>
            </Card>
          ) : rows.length > 0 ? (
            <EmptyState
              title="No matching requests"
              action={
                <Button icon={<Icon name="filter" />} onClick={() => setFilter('all')}>
                  Show all requests
                </Button>
              }
            >
              Nothing in the log matches this filter. {plural(rows.length, 'request')} captured in
              total.
            </EmptyState>
          ) : loadedDetails.length === 0 && failed.length > 0 ? (
            /* Nothing was read, so nothing is known about the log. Saying it is empty and
               inviting more traffic sends somebody to generate requests to fix a failed
               read. The strip above already names the cause. */
            <EmptyState
              title="Could not read the request log"
              action={
                <Button icon={<Icon name="bolt" />} onClick={refreshAll}>
                  Try again
                </Button>
              }
            >
              {plural(failed.length, 'imposter')} could not be read, and none answered, so there is
              nothing to show — this is not the same as a log with nothing in it.
            </EmptyState>
          ) : (
            <EmptyState title={failed.length > 0 ? 'Nothing captured yet from the imposters that answered' : 'Nothing captured yet'}>
              {/*
                What follows has to be read off THIS instance.
                
                It used to say "both remote instances run with --mock" — true of the two this
                panel was first written against, and a claim about somebody else's deployment
                everywhere since. `--mock` records every request whatever an imposter says, so
                whether it is on decides whether this screen can ever fill, and the instance
                reports it in GET /config.
              */}
              Send a request to one of the {plural(imposters.length, 'imposter')} in{' '}
              {environment.label} and it appears here.{' '}
              {facts.recordsEverything ? (
                <>
                  This instance runs with <span className="mono">--mock</span>, so what they
                  receive is kept even where an imposter has{' '}
                  <span className="mono">recordRequests: false</span>.
                </>
              ) : recording === 0 && imposters.length > 0 ? (
                <>
                  None of them are recording, though, so nothing will arrive until{' '}
                  <b>Record requests</b> is on for at least one — it is on the imposter&rsquo;s own
                  Settings tab.
                </>
              ) : null}
            </EmptyState>
          )}
        </>
      )}

      {selectedRow ? (
        <RequestDrawer
          open={drawerOpen}
          onClose={closeDrawer}
          env={env}
          imposter={selectedRow.imposter}
          request={selectedRow.request}
        />
      ) : null}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   Pieces
   ══════════════════════════════════════════════════════════════ */

function RequestRow({
  row,
  onOpen,
  reportsMatches,
}: {
  row: Row;
  onOpen: (row: Row) => void;
  reportsMatches: boolean;
}) {
  const { request, imposter, outcome } = row;
  const stub = outcome.stub;
  const signature = stub ? sigOf(stub) : null;

  return (
    <tr className="click" onClick={() => onOpen(row)}>
      <td>
        <Verb method={request.method} />
      </td>
      <td>
        {/* a real button, so the row is reachable and operable from the keyboard */}
        <button
          type="button"
          className={styles.path}
          title={request.path}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(row);
          }}
        >
          {request.path}
        </button>
      </td>
      <td className={styles.nowrap}>{imposter.name || `port ${imposter.port}`}</td>
      <td title={statusSourceNote(outcome, reportsMatches)}>
        <Pill tone={statusPillTone(outcome.status)}>
          {outcome.status === null ? 'unknown' : outcome.status}
        </Pill>
      </td>
      <td className={`mono num ${styles.nowrap}`}>
        {outcome.waitMs > 1000 ? (
          <Off>{outcome.waitMs} ms wait</Off>
        ) : outcome.waitMs > 0 ? (
          `${outcome.waitMs} ms wait`
        ) : (
          <span className={styles.muted}>no delay</span>
        )}
      </td>
      <td>
        {stub && signature ? (
          <span className={styles.matched}>
            <span
              className={styles.stubPath}
              title={`Stub #${(outcome.stubIndex ?? 0) + 1} · ${signature.method} ${signature.path} · ${statusLabel(outcome.status)}`}
            >
              #{(outcome.stubIndex ?? 0) + 1} {signature.path}
            </span>
            {outcome.unevaluable ? (
              <Pill tone="warn" dot>
                unconfirmed
              </Pill>
            ) : null}
          </span>
        ) : (
          <span className={styles.matched}>
            <Pill tone="err" dot>
              none
            </Pill>
            {outcome.unevaluable ? (
              <Pill tone="warn" dot>
                unconfirmed
              </Pill>
            ) : null}
          </span>
        )}
      </td>
      <td
        className={`cell-sub num ${styles.nowrap}`}
        title={request.timestamp ? hhmm(request.timestamp) : undefined}
      >
        {request.timestamp ? ago(request.timestamp) : 'unknown'}
      </td>
    </tr>
  );
}
