/**
 * One imposter, in four tabs: Stubs, Requests, Settings, JSON.
 *
 * The port in the URL is the identity — mountebank has no other id for an
 * imposter — so this screen reads it from the route and everything else hangs
 * off `useImposter(env, port)`.
 *
 * It also honours the shell's two search-param contracts (see App.tsx), which is
 * how the topbar, the command palette and the request drawer open the stub
 * editor without reaching into this screen's state:
 *
 *   ?new=stub       a blank stub editor (optionally seeded from a request)
 *   ?stub=<index>   the editor for the stub at that index
 *
 * Three honesty rules the screen keeps:
 *
 *  • A failed read names its own cause — a refused origin and a dead host are
 *    told apart, not guessed between — and offers a retry.
 *  • Which stub answered a captured request is COMPUTED here (match.ts), because
 *    the admin API only reports it when the instance runs with `--debug`. Per-stub
 *    hit counts come from the same computation, and both are labelled as
 *    computed.
 *  • Nothing is written while typing: an imposter edit is delete-then-create, so
 *    settings and JSON both need an explicit save.
 */

import { useEffect, useId, useState } from 'react';
import axios from 'axios';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { type EnvId } from '../lib/environments';
import { envOr } from '../store/useEnvironments';
import { ago, hhmm, plural } from '../lib/format';
import type { Imposter, RecordedRequest, Stub } from '../lib/mb/types';
import {
  useCreateImposter,
  useDeleteImposter,
  useImposter,
  useImposters,
  useReorderStubs,
  useReplaceImposter,
} from '../lib/queries';
import { keptFor, matchSource, useInstanceFacts, whyMatchIsComputed } from '../lib/mb/instanceFacts';
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
import { ImposterJson } from './ImposterJson';
import { ImposterSettings } from './ImposterSettings';
import {
  RequestDrawer,
  statusSourceNote,
  deriveOutcome,
  statusLabel,
  statusPillTone,
} from './RequestDrawer';
import { DEMO_BUILD } from '../lib/demo/instance';
import { Failure } from './Failure';
import { StubEditor } from './StubEditor';
import { StubList } from './StubList';
import styles from './ImposterDetail.module.css';

export type ImposterTab = 'stubs' | 'activity' | 'settings';

/** Long enough for the drawer's exit transition to finish. */
const DRAWER_EXIT_MS = 300;

/** Router state a deep link may carry: a stub prefilled from a request. */
interface NewStubState {
  newStub?: Stub;
}

/** An imposter answers on the same host as the admin API that created it. */
function hostOf(target: string): string {
  try {
    return new URL(target).hostname;
  } catch {
    return target;
  }
}

export function ImposterDetail() {
  const params = useParams<{ env?: string; port?: string }>();
  const storeEnv = useStudio((s) => s.env);
  // the URL wins — a link must land whoever opens it in the right environment
  const environment = envOr(params.env ?? storeEnv);
  const env = environment.id;

  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const baseId = useId();
  /* Read once for the whole screen: whether this instance keeps traffic regardless of an
     imposter's own flag decides what the strips below may claim. */
  const pageFacts = useInstanceFacts(env);

  const port = Number(params.port);
  const portOk = Number.isInteger(port) && port > 0;

  const [tab, setTab] = useState<ImposterTab>('stubs');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  /** A stub prefilled from a captured request, handed to the editor as a seed. */
  const [seedStub, setSeedStub] = useState<Stub | null>(null);
  /** Which captured request the drawer is showing, held by id. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);

  const detail = useImposter(env, port);
  const all = useImposters(env);
  const replace = useReplaceImposter(env);
  const create = useCreateImposter(env);
  const remove = useDeleteImposter(env);
  const reorder = useReorderStubs(env);

  const saving = replace.isPending || create.isPending || remove.isPending || reorder.isPending;

  /* ------------------------- the stub editor, from the URL ---------------- */

  const wantsNewStub = search.get('new') === 'stub';
  const stubParam = search.get('stub');
  const askedIndex = stubParam === null ? null : Number(stubParam);
  const openIndex =
    askedIndex !== null && Number.isInteger(askedIndex) && askedIndex >= 0 ? askedIndex : null;
  const editorOpen = wantsNewStub || openIndex !== null;

  // an editor opened from the topbar while another tab was showing belongs with
  // the stubs, and that is also where you want to land when it closes
  useEffect(() => {
    if (editorOpen) setTab('stubs');
  }, [editorOpen]);

  function setParams(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(search);
    mutate(next);
    setSearch(next, { replace: true });
  }

  const openStub = (index: number) =>
    setParams((next) => {
      next.delete('new');
      next.set('stub', String(index));
    });

  function openNewStub(seed?: Stub) {
    setSeedStub(seed ?? null);
    setParams((next) => {
      next.delete('stub');
      next.set('new', 'stub');
    });
  }

  function closeEditor() {
    setSeedStub(null);
    setParams((next) => {
      next.delete('stub');
      next.delete('new');
    });
  }

  /* ------------------------------ before the data ------------------------- */

  if (!portOk) {
    return (
      <>
        <PageHead eyebrow="Imposter" title="Not an imposter port" />
        <EmptyState
          title="That URL does not name a port"
          action={
            <Button onClick={() => void navigate(`/${env}/imposters`)}>Back to Imposters</Button>
          }
        >
          Mountebank identifies an imposter by the port it listens on, and{' '}
          <span className="mono">{params.port ?? '—'}</span> is not one.
        </EmptyState>
      </>
    );
  }

  if (detail.isPending) {
    return (
      <>
        <PageHead
          eyebrow={`Imposter · port ${port}`}
          title="Loading…"
          sub={`Reading port ${port} from ${environment.label}.`}
        />
        <Card>
          <div className={styles.state}>
            <span className={styles.dot} />
            Asking Mountebank for this imposter and its captured requests…
          </div>
        </Card>
      </>
    );
  }

  if (detail.isError) {
    return (
      <>
        <PageHead
          eyebrow={`Imposter · port ${port}`}
          title="Could not load this imposter"
          sub={`${environment.label} did not return port ${port}.`}
        />
        <p className={styles.fail}>
          <Failure target={environment.target} error={detail.error} />
        </p>
        <EmptyState
          title="Nothing to show"
          action={
            <Button
              variant="primary"
              icon={<Icon name="chev" />}
              disabled={detail.isFetching}
              onClick={() => void detail.refetch()}
            >
              {detail.isFetching ? 'Retrying…' : 'Try Again'}
            </Button>
          }
        >
          {/* The Failure line above has already named the cause, and in the commonest third
              case — an instance that answered but refuses this page — both halves of the
              old guess were false. The 404 hint is the one thing Failure cannot supply, so
              it is shown only when the error actually was one. */}
          {axios.isAxiosError(detail.error) && detail.error.response?.status === 404
            ? 'A freed port answers 404, so this imposter is probably gone.'
            : 'The stubs and captured requests for this imposter could not be read.'}
        </EmptyState>
      </>
    );
  }

  const { imposter, requests } = detail.data;
  /* What this instance keeps, so the recording strip below cannot contradict a full
     Activity tab. */
  const kept = keptFor(pageFacts, imposter.recordRequests);

  /* --------------------------------- derived ------------------------------ */

  const host = hostOf(environment.target);
  const hits = imposter.stubs.map(
    (_stub, index) => requests.filter((r) => r.matchedStubIndex === index).length,
  );

  const navState = location.state as NewStubState | null;
  const seed = seedStub ?? navState?.newStub;
  const selectedRequest = requests.find((r) => r.id === selectedId) ?? null;

  const tabs: Array<{ id: ImposterTab; label: string; count: number | null }> = [
    { id: 'stubs', label: 'Stubs', count: imposter.stubs.length },
    { id: 'activity', label: 'Activity', count: requests.length },
    /* JSON is not a tab of its own any more: it lives inside Settings, above the one
       field that is a slice of it. Two tabs editing the same object hid each other. */
    { id: 'settings', label: 'Settings', count: null },
  ];

  /* --------------------------------- actions ------------------------------ */

  function openRequest(request: RecordedRequest) {
    setSelectedId(request.id);
    setRequestOpen(true);
  }

  function closeRequest() {
    setRequestOpen(false);
    window.setTimeout(() => setSelectedId(null), DRAWER_EXIT_MS);
  }

  function moveStub(index: number, direction: -1 | 1) {
    const next = [...imposter.stubs];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(target, 0, moved);
    reorder.mutate({ port: imposter.port, stubs: next });
  }

  /** The next port nothing else has claimed, so a duplicate always starts. */
  function freePort(from: number): number {
    const taken = new Set((all.data ?? []).map((i) => i.port));
    let candidate = Math.max(from, ...taken) + 1;
    while (taken.has(candidate)) candidate += 1;
    return candidate;
  }

  /**
   * Duplicating starts a real server on a shared environment, so it asks first —
   * the same bar as deleting. Firing it straight off a click is how a stray
   * imposter ends up on someone else's dev box.
   */
  function reallyDuplicate() {
    create.mutate({
      ...imposter,
      name: `${imposter.name}-copy`,
      port: freePort(imposter.port),
      numberOfRequests: 0,
    });
    setConfirmDuplicate(false);
  }

  /**
   * A settings save or a JSON apply. When the port itself changed, the old
   * imposter must be stopped explicitly: `replaceImposter` deletes the port it is
   * handed, which would leave the original one still listening.
   */
  async function applyImposter(next: Imposter) {
    if (next.port === imposter.port) {
      replace.mutate(next);
      return;
    }
    try {
      await remove.mutateAsync({ port: imposter.port, name: imposter.name });
      await create.mutateAsync(next);
      void navigate(`/${env}/imposters/${next.port}`, { replace: true });
    } catch {
      /* both mutations report their own failure as a toast */
    }
  }

  function reallyDelete() {
    remove.mutate(
      { port: imposter.port, name: imposter.name },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          void navigate(`/${env}/imposters`);
        },
      },
    );
  }

  /* ---------------------------------- render ------------------------------ */

  return (
    <>
      <PageHead
        eyebrow={`Imposter · ${imposter.protocol} · port ${imposter.port}`}
        title={imposter.name}
        tools={
          <>
            {/* Its own name, port, protocol and default response are edited under
                Settings, which is not obvious from a tab strip below the fold. */}
            <Button
              icon={<Icon name="cog" />}
              disabled={saving}
              title="Name, port, protocol, default response and the whole JSON"
              onClick={() => setTab('settings')}
            >
              Edit
            </Button>
            <Button
              variant="primary"
              icon={<Icon name="plus" />}
              disabled={saving}
              title="New Stub"
              onClick={() => {
                setTab('stubs');
                openNewStub();
              }}
            >
              New Stub
            </Button>
            <Button
              icon={<Icon name="copy" />}
              disabled={saving}
              title="Copy this imposter onto a free port"
              onClick={() => setConfirmDuplicate(true)}
            >
              Duplicate
            </Button>
          </>
        }
      />

      <Strip tone="info" icon={<Icon name="imps" />} title="Where this imposter answers">
        {DEMO_BUILD ? (
          /* The demo runs no imposters, so telling somebody to point a service at this
             port would be an instruction that cannot work. Say what would be true. */
          <>
            On an instance you run, the service under test would be pointed at{' '}
            <span className="mono">localhost:{imposter.port}</span> and would talk to the stubs
            below instead of the real service. In this demo nothing is listening on that port —
            the stubs, the traffic and every screen are real, the socket is not.
          </>
        ) : (
          <>
            Point the service under test at{' '}
            <span className="mono">
              {host}:{imposter.port}
            </span>{' '}
            and it talks to the stubs below instead of the real service. They are matched top to
            bottom, and the tabs above count the stubs it holds and the requests it has captured —
            which is not the same as what it has received, unless it is recording.
          </>
        )}
      </Strip>

      {/*
        Read off the instance, not off the imposter alone. A --mock instance keeps every
        request whatever recordRequests says, and this strip used to appear next to an
        Activity tab full of traffic, telling the reader to turn on a flag that would
        change nothing.
      */}
      {imposter.recordRequests ? null : kept.kept ? (
        <Strip tone="info" icon={<Icon name="reqs" />} title="Recording is on for the instance">
          {kept.because}
        </Strip>
      ) : (
        <Strip tone="warn" icon={<Icon name="alert" />} title="Recording is off">
          {kept.because} Turn <b>Record requests</b> on in the Settings tab to start capturing.
        </Strip>
      )}

      <div className={styles.tabs} role="tablist" aria-label="Imposter sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            id={`${baseId}-tab-${t.id}`}
            className={styles.tab}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`${baseId}-panel-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count !== null ? <span className={styles.count}>{t.count}</span> : null}
          </button>
        ))}
      </div>

      <div
        id={`${baseId}-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${tab}`}
        tabIndex={-1}
      >
        {tab === 'stubs' ? (
          <StubList
            env={env}
            stubs={imposter.stubs}
            hits={hits}
            busy={saving}
            onOpen={openStub}
            onMove={moveStub}
          />
        ) : null}

        {tab === 'activity' ? (
          <CapturedRequests
            env={env}
            imposter={imposter}
            requests={requests}
            onOpenRequest={openRequest}
          />
        ) : null}

        {tab === 'settings' ? (
          <ImposterSettings
            key={imposter.port}
            imposter={imposter}
            saving={saving}
            onSave={(next) => void applyImposter(next)}
            onDelete={() => setConfirmDelete(true)}
            json={
              <ImposterJson
                key={imposter.port}
                imposter={imposter}
                saving={saving}
                onApply={(next) => void applyImposter(next)}
              />
            }
          />
        ) : null}

      </div>

      <Modal
        open={confirmDuplicate}
        onClose={() => setConfirmDuplicate(false)}
        title={`Duplicate ${imposter.name}?`}
        subtitle={`A new imposter starts listening on port ${freePort(imposter.port)} in ${environment.label}.`}
        footer={
          <>
            <Button onClick={() => setConfirmDuplicate(false)}>Cancel</Button>
            <Button
              variant="primary"
              icon={<Icon name="copy" />}
              disabled={create.isPending}
              onClick={reallyDuplicate}
            >
              {create.isPending ? 'Duplicating…' : 'Duplicate Imposter'}
            </Button>
          </>
        }
      >
        <p className={styles.note}>
          Its {plural(imposter.stubs.length, 'stub')} come along; captured requests do not. Everyone
          pointed at {environment.label} will see the new port.
        </p>
      </Modal>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${imposter.name}?`}
        subtitle={`Port ${imposter.port} is freed immediately.`}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Keep It</Button>
            <Button
              variant="danger"
              icon={<Icon name="trash" />}
              disabled={remove.isPending}
              onClick={reallyDelete}
            >
              {remove.isPending ? 'Deleting…' : 'Delete Imposter'}
            </Button>
          </>
        }
      >
        <p className={styles.note}>
          {plural(imposter.stubs.length, 'stub')} and {plural(requests.length, 'captured request')}{' '}
          go with it. This can&rsquo;t be undone.
        </p>
      </Modal>

      <StubEditor
        open={editorOpen}
        onClose={closeEditor}
        index={wantsNewStub ? null : openIndex}
        port={imposter.port}
        seed={seed}
      />

      {selectedRequest ? (
        <RequestDrawer
          open={requestOpen}
          onClose={closeRequest}
          env={env}
          imposter={imposter}
          request={selectedRequest}
          onOpenStub={(_imposter, index) => {
            closeRequest();
            openStub(index);
          }}
          onCreateStub={(_imposter, draft) => {
            closeRequest();
            openNewStub(draft);
          }}
        />
      ) : null}
    </>
  );
}

/* ═══════════════════════════════  requests tab  ══════════════════════════ */

interface CapturedRequestsProps {
  env: EnvId;
  imposter: Imposter;
  requests: RecordedRequest[];
  onOpenRequest: (request: RecordedRequest) => void;
}

/** The captured request log for this one imposter, newest first. */
function CapturedRequests({ env, imposter, requests, onOpenRequest }: CapturedRequestsProps) {
  /* Every note in this table about what mountebank did or did not keep comes from here,
     not from a constant. Both halves of the old note turned on --debug and only one of
     them said so. */
  const facts = useInstanceFacts(env);
  const kept = keptFor(facts, imposter.recordRequests);

  if (!requests.length) {
    return (
      <EmptyState title="Nothing captured yet">
        {kept.kept
          ? `Send a request to port ${imposter.port} and it shows up here.`
          : /* "above" named no control: the only thing above is a strip that itself
               points at the Settings tab. */
            `${kept.because} Turn it on in the Settings tab to start capturing.`}
      </EmptyState>
    );
  }

  // the log is append-only, so reversing it is exactly "newest first"
  const rows = [...requests].reverse();

  return (
    <>
      <p className={styles.computed}>
        <Icon name="alert" />
        <span>{whyMatchIsComputed(facts)} Status and delay are then read from that stub.</span>
      </p>

      <Card flush>
        <Table
          head={
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th title={matchSource(facts)}>Status</th>
              <th title={matchSource(facts)}>Delay</th>
              <th title={matchSource(facts)}>Matched stub</th>
              <th>When</th>
            </tr>
          }
        >
          {rows.map((request) => {
            const outcome = deriveOutcome(imposter, request);
            const signature = outcome.stub === null ? null : sigOf(outcome.stub);

            return (
              <tr key={request.id} className="click" onClick={() => onOpenRequest(request)}>
                <td>
                  <Verb method={request.method} />
                </td>
                <td className="mono">
                  <span className={`cell-clip ${styles.path}`} title={request.path}>
                    {request.path}
                  </span>
                </td>
                <td title={statusSourceNote(outcome, facts.reportsMatches)}>
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
                  <span className={styles.matched}>
                    {signature === null ? (
                      <Pill tone="err" dot>
                        none
                      </Pill>
                    ) : (
                      <span
                        className={`cell-clip ${styles.stubRef}`}
                        title={`Stub #${(outcome.stubIndex ?? 0) + 1} · ${signature.method} ${signature.path} · ${statusLabel(outcome.status)}`}
                      >
                        #{(outcome.stubIndex ?? 0) + 1} {signature.path}
                      </span>
                    )}
                    {outcome.unevaluable ? (
                      <Pill tone="warn" dot>
                        unconfirmed
                      </Pill>
                    ) : null}
                  </span>
                </td>
                <td
                  className={`cell-sub num ${styles.nowrap}`}
                  title={request.timestamp ? hhmm(request.timestamp) : undefined}
                >
                  {request.timestamp ? ago(request.timestamp) : 'unknown'}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}

export default ImposterDetail;
