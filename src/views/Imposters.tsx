/**
 * Imposters — the list, and the way in.
 *
 * Ported from the prototype's `viewImposters()` + `impTable()`: eyebrow, title,
 * the "Ports in use" recap, then one row per mock server with its row actions.
 *
 * Three things worth knowing about the port on this screen:
 *
 *  1. THE PORT IS THE IDENTITY. Mountebank keys an imposter by port, so the
 *     port is the row's link target and the delete confirmation talks about the
 *     port being freed, not about a record being removed.
 *
 *  2. A COLLISION IS FLAGGED, NOT ASSUMED IMPOSSIBLE. A live instance cannot
 *     really serve two imposters on one port, but the recap still checks, in
 *     `<Off>`, because a duplicate here would mean the list is lying about what
 *     is answering.
 *
 *  3. "SAVE CONFIG" IS ONE PUT. It replaces the whole imposter set with what is
 *     on screen, which recreates each imposter and therefore clears captured
 *     traffic — so it asks first. The prototype wrote a local file; against a
 *     live instance the same button has consequences, and says so.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { type EnvId } from '../lib/environments';
import { envOr } from '../store/useEnvironments';
import { plural } from '../lib/format';
import { describeError, replaceAll } from '../lib/mb/client';
import type { Imposter } from '../lib/mb/types';
import { saveJson } from '../lib/download';
import { toPostmanCollection } from '../lib/postman';
import { mbKeys, useCreateImposter, useDeleteImposter, useImposters } from '../lib/queries';
import { useStudio } from '../store/useStudio';
import { Button, Card, EmptyState, Icon, Modal, PageHead, Pill, Strip, Table } from '../ui';
import { Failure } from './Failure';
import { NewImposterModal } from './NewImposterModal';
import styles from './Imposters.module.css';

/* ────────────────────────────────  free ports  ─────────────────────────── */

/** Where this panel starts looking for a free port when it creates an imposter. */
const FIRST_PORT = 4545;

const LAST_PORT = 65_535;

/**
 * The lowest free port at or above `from` in THIS environment — what the create
 * modal prefills and what "Duplicate" claims.
 *
 * Free means "no imposter in the list holds it". Mountebank can still refuse it
 * because something else on the host is listening, which is why a failed write
 * is surfaced as a toast rather than swallowed — but the common case, a port
 * already claimed by a mock, is answered without a round trip.
 */
function nextFreePort(imposters: Imposter[], from: number = FIRST_PORT): number {
  const taken = new Set(imposters.map((i) => i.port));
  let port = Math.max(1, Math.trunc(from));
  while (port < LAST_PORT && taken.has(port)) port += 1;
  return port;
}

/* ───────────────────────────────  save config  ─────────────────────────── */

/**
 * `PUT /imposters` — the whole set at once.
 *
 * Built here rather than in `queries.ts` so the confirmation and the write stay
 * in one place, but it follows the same contract as every mutation there: success
 * invalidates the environment's whole cache, and both outcomes end in a toast.
 */
function useSaveConfig(env: EnvId) {
  const queryClient = useQueryClient();
  const toast = useStudio((s) => s.toast);

  return useMutation<unknown, Error, Imposter[]>({
    mutationFn: (imposters) => replaceAll(env, imposters),
    onSuccess: (_data, imposters) => {
      void queryClient.invalidateQueries({ queryKey: mbKeys.env(env) });
      toast(`${plural(imposters.length, 'imposter')} written to ${envOr(env).label}`);
    },
    onError: (error) => toast(describeError(error), 'err'),
  });
}

/* ─────────────────────────────────  screen  ────────────────────────────── */

export function Imposters() {
  const routeEnv = useParams<{ env?: string }>().env;
  const storeEnv = useStudio((s) => s.env);
  // the URL wins when it names a real environment; findEnv falls back for the rest
  const environment = envOr(routeEnv ?? storeEnv);
  const env = environment.id;

  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();

  const imposters = useImposters(env);
  const create = useCreateImposter(env);
  const remove = useDeleteImposter(env);
  const saveConfig = useSaveConfig(env);

  /**
   * `?new=imposter` keeps the create flow in the URL, so it survives a reload and
   * can be linked to. This screen's own button is the only thing that sets it.
   */
  const creating = search.get('new') === 'imposter';
  /*
   * Creating needs the live list — the form refuses a port that is already taken,
   * and it cannot know what is taken until the environment has answered. So the
   * door is shut, visibly, while the list is unread rather than opening a form
   * whose first write would fail.
   */
  const canCreate = imposters.isSuccess;
  const [pendingDelete, setPendingDelete] = useState<Imposter | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);

  /*
   * `?new=imposter` on a screen that cannot read the environment would leave the
   * URL claiming a form is open while nothing is. Clear it — but only on a real
   * failure, so a shared link still opens the form once the list arrives.
   */
  useEffect(() => {
    if (creating && imposters.isError) closeCreate();
  });

  const openCreate = (): void => {
    const next = new URLSearchParams(search);
    next.set('new', 'imposter');
    setSearch(next, { replace: true });
  };

  const closeCreate = (): void => {
    const next = new URLSearchParams(search);
    next.delete('new');
    setSearch(next, { replace: true });
  };

  const detailPath = (port: number): string => `/${env}/imposters/${port}`;

  /* The export reports its own outcome, and the create/delete paths already toast. */
  const toast = useStudio((s) => s.toast);

  const list = imposters.data ?? [];

  /**
   * The mocks as something to fire at them.
   *
   * A stub is a condition and a request is one instance of it, so the conversion is lossy
   * in ways that matter — `startsWith`, `not`, `or`, `exists` — and each request carries a
   * description of what was left behind. This only reports the counts: how much came out,
   * and how many imposters had no URL Postman could send to.
   */
  function downloadPostman(): void {
    const { collection, skipped } = toPostmanCollection(environment.label, list);
    const requests = collection.item.reduce((n, folder) => n + folder.item.length, 0);

    if (collection.item.length === 0) {
      toast(
        list.length === 0
          ? 'There are no imposters here to export'
          : 'No imposter here speaks http, so there is nothing Postman could send to',
        'warn',
      );
      return;
    }

    saveJson(`${environment.id}-mountebank.postman_collection.json`, collection);
    toast(
      `${plural(requests, 'request')} in ${plural(collection.item.length, 'folder')}` +
        (skipped.length === 0 ? '' : ` · ${plural(skipped.length, 'imposter')} left out`),
    );
  }
  const ports = list.map((i) => i.port);
  const collision = ports.length !== new Set(ports).size;

  /**
   * Duplicate: same stubs, next free port, `-copy` on the name.
   *
   * Stub ids are not copied deliberately-fresh — they are UI-local, never sent
   * to mountebank, and the refetch that follows this write remints them anyway.
   */
  const duplicate = (source: Imposter): void => {
    create.mutate({
      ...source,
      port: nextFreePort(list),
      name: `${source.name}-copy`,
      numberOfRequests: 0,
    });
  };

  const head = (
    <PageHead
      eyebrow={
        imposters.isSuccess ? `Mock servers · ${plural(list.length, 'imposter')}` : 'Mock servers'
      }
      title="Imposters"
      /* The only New Imposter in the product. Nothing in the topbar, the rail,
         the palette or the Overview offers it any more — one screen, one door. */
      tools={
        <>
          <Button
            variant="primary"
            icon={<Icon name="plus" />}
            disabled={!canCreate}
            title={
              canCreate
                ? 'New Imposter'
                : `${environment.label} has not answered yet — nothing can be created until it does`
            }
            onClick={openCreate}
          >
            New Imposter
          </Button>
          <Button
            icon={<Icon name="save" size={14} />}
            onClick={() => setConfirmSave(true)}
            disabled={list.length === 0 || saveConfig.isPending}
            title="Send every imposter to this environment in one write"
          >
            Save Config
          </Button>
          {/* Reading the mocks back out belongs next to the list of them, which is where
              anyone looks for "export all of this" — it was in Settings, under
              Maintenance, where it went unfound. */}
          <Button
            icon={<Icon name="down" size={14} />}
            onClick={downloadPostman}
            disabled={list.length === 0}
            title="Every imposter as a folder and every stub as a request that satisfies it"
          >
            Postman Collection
          </Button>
        </>
      }
    />
  );

  const intro = (
    <Strip tone="info" icon={<Icon name="imps" />} title="What an imposter is">
      One mock server on one port. Point the service under test at that port and it answers from the
      stubs you define instead of calling the real service. Ports are how they are told apart, so
      two imposters can never share one.
    </Strip>
  );

  /* The caution the user wrote on this environment, if they wrote one. */
  const envNote =
    environment.note === undefined || environment.note === '' ? null : (
      <p className={styles.note}>
        <Icon name="alert" size={14} />
        <span>{environment.note}</span>
      </p>
    );

  /*
   * Every overlay this screen owns, rendered in ALL THREE states below. They used
   * to live in the success branch only, which made New Imposter a dead click
   * whenever the list had not been read: the button set `?new=imposter`, the early
   * return kept the modal out of the tree, and nothing happened.
   */
  const overlays = (
    <>
      <NewImposterModal
        open={creating && canCreate}
        onClose={closeCreate}
        env={env}
        imposters={list}
        suggestedPort={nextFreePort(list)}
      />

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={pendingDelete !== null ? `Delete ${pendingDelete.name}?` : 'Delete imposter?'}
        subtitle={
          pendingDelete !== null ? `Port ${pendingDelete.port} is freed immediately.` : undefined
        }
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)}>Keep It</Button>
            <Button
              variant="danger"
              icon={<Icon name="trash" size={14} />}
              disabled={remove.isPending}
              onClick={() => {
                if (pendingDelete === null) return;
                remove.mutate({ port: pendingDelete.port, name: pendingDelete.name });
                setPendingDelete(null);
              }}
            >
              Delete imposter
            </Button>
          </>
        }
      >
        <p className={styles.confirm}>
          {pendingDelete !== null
            ? `${plural(pendingDelete.stubs.length, 'stub')} and ${plural(
                pendingDelete.numberOfRequests,
                'captured request',
              )} go with it. This can't be undone.`
            : null}
        </p>
      </Modal>

      <Modal
        open={confirmSave}
        onClose={() => setConfirmSave(false)}
        title={`Write ${plural(list.length, 'imposter')} to ${environment.label}?`}
        subtitle="One PUT replaces the whole imposter set."
        footer={
          <>
            <Button onClick={() => setConfirmSave(false)}>Not Now</Button>
            <Button
              variant="primary"
              icon={<Icon name="save" size={14} />}
              disabled={saveConfig.isPending}
              onClick={() => {
                saveConfig.mutate(list);
                setConfirmSave(false);
              }}
            >
              Write config
            </Button>
          </>
        }
      >
        <p className={styles.confirm}>
          Mountebank replaces every imposter with exactly what this screen shows. Each one is
          recreated, so ports go down and come back and captured requests are cleared. Stubs are
          written as they are here.
        </p>
      </Modal>
    </>
  );

  /* ---------- in flight ---------- */
  if (imposters.isPending) {
    return (
      <>
        {head}
        {intro}
        {envNote}
        <Card flush>
          <div className={styles.pad}>
            <EmptyState title="Loading imposters…">
              Asking {environment.label} for everything it is running.
            </EmptyState>
          </div>
        </Card>
        {overlays}
      </>
    );
  }

  /* ---------- unreachable ---------- */
  if (imposters.isError) {
    return (
      <>
        {head}
        {intro}
        {envNote}
        <Card flush>
          <div className={styles.pad}>
            <EmptyState
              wide
              title={`Could not read ${environment.label}`}
              action={
                <Button
                  variant="primary"
                  onClick={() => void imposters.refetch()}
                  disabled={imposters.isFetching}
                >
                  Try again
                </Button>
              }
            >
              <Failure target={environment.target} error={imposters.error}>
                Nothing was changed — this screen only reads until you ask it to write.
              </Failure>
            </EmptyState>
          </div>
        </Card>
        {overlays}
      </>
    );
  }

  /* ---------- the list ---------- */
  return (
    <>
      {head}
      {intro}
      {envNote}

      {collision ? (
        <Strip tone="warn" icon={<Icon name="alert" />} title="Two imposters claim the same port">
          Mountebank can only bind one of them, so which stubs answer on that port is not
          predictable. Change one of the ports below.
        </Strip>
      ) : null}

      <Card flush>
        {list.length === 0 ? (
          <div className={styles.pad}>
            <EmptyState
              title="No imposters yet"
              action={
                <Button
                  variant="primary"
                  icon={<Icon name="plus" size={14} />}
                  onClick={openCreate}
                  disabled={!canCreate}
                >
                  New Imposter
                </Button>
              }
            >
              An imposter is one mock server on one port. Create one, then add stubs that decide
              what it answers.
            </EmptyState>
          </div>
        ) : (
          <Table
            head={
              <tr>
                <th>Imposter</th>
                <th>Port</th>
                <th>Protocol</th>
                <th>Stubs</th>
                <th>Requests</th>
                <th>Recording</th>
                <th>
                  <span className={styles.srOnly}>Row actions</span>
                </th>
              </tr>
            }
          >
            {list.map((imposter) => (
              <tr
                key={imposter.port}
                className="click"
                onClick={() => navigate(detailPath(imposter.port))}
              >
                <td>
                  <div className="imp-name">
                    {/* mountebank only lists what it is actually serving */}
                    <Pill tone="ok" dot>
                      Running
                    </Pill>
                    <Link
                      className={styles.name}
                      to={detailPath(imposter.port)}
                      onClick={(e) => e.stopPropagation()}
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
                <td className="mono num">{imposter.numberOfRequests}</td>
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
                      title="Duplicate"
                      aria-label={`Duplicate ${imposter.name}`}
                      disabled={create.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicate(imposter);
                      }}
                    />
                    <Button
                      variant="ghost"
                      className="btn--danger"
                      iconOnly
                      icon={<Icon name="trash" />}
                      title="Delete"
                      aria-label={`Delete ${imposter.name}`}
                      disabled={remove.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(imposter);
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {overlays}
    </>
  );
}
