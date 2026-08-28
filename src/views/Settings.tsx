/**
 * Settings — the instances this browser knows about, what the selected one
 * allows, and the two bits of housekeeping the admin API offers.
 *
 * Three blocks, in the order they matter: the environments (the only thing on
 * this screen the panel itself owns), then facts read off the selected instance,
 * then actions that run against it.
 *
 * ENVIRONMENTS ARE USER DATA. Nothing about them is compiled in — they are
 * records the user creates here and this browser keeps
 * (src/store/useEnvironments.ts), which is why full CRUD lives on this screen and
 * why removing one is described as the panel forgetting a connection rather than
 * as a change to anything running.
 *
 * Nothing else here invents state. Every fact about the running mountebank comes
 * from `GET /config` and is shown with its own loading and error state. The page
 * never claims an instance is "reachable" — it either has an answer from that
 * instance or it says the request failed.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { isProxied, type EnvId, type MbEnvironment } from '../lib/environments';
import { resolveTarget } from '../lib/mb/reach';
import { DEMO_BUILD } from '../lib/demo/instance';
import { plural } from '../lib/format';
import { clearProxyResponses, clearRequests, describeError } from '../lib/mb/client';
import { imposterToMb, pretty } from '../lib/mb/model';
import type { MbConfig } from '../lib/mb/types';
import { mbKeys, useConfig, useImposters } from '../lib/queries';
import { useEnvironments, type EnvironmentDraft } from '../store/useEnvironments';
import { useStudio } from '../store/useStudio';
import { Button, CodeEditor, EmptyState, Icon, Modal, PageHead, Pill, Section, Strip } from '../ui';
import { EnvironmentForm } from './EnvironmentForm';
import { Failure } from './Failure';
import { setInjection } from '../lib/mb/store';
import { StoreSection } from './StoreSection';
import styles from './Settings.module.css';

/* ─────────────────────────────  small formatters  ──────────────────────── */

/** Process uptime, coarse on purpose — the exact second is never the question. */
function uptimeText(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return 'not reported';
  const total = Math.max(0, Math.round(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${total % 60}s`;
  return `${total}s`;
}

/**
 * The origins this instance was started with.
 *
 * `--origin` is mountebank's CORS switch — there is no `allowCORS` option in this version
 * — and `GET /config` reports it as `options.origin`, `false` when it was started without
 * one.
 *
 * IT IS NOT A PIPE-SEPARATED LIST. That belief was here and in the README, and it was
 * wrong in a way that mattered: mountebank hands the value straight to the `cors`
 * middleware (`mountebank.js:81`), so `--origin "a|b"` echoes the literal string
 * `a|b` as `Access-Control-Allow-Origin`, which is not a valid origin and which no
 * browser accepts — the panel reported such an instance as allowing this page, and
 * printed that command as the fix. Measured on 2.9.4.
 *
 * Several origins come from REPEATING the flag, which yargs collects into an array and
 * `cors` matches one at a time (verified: a third origin then gets no header at all).
 *
 * Read defensively: it is the single field the panel's ability to read this instance
 * depends on, and an older instance may not send it at all.
 */
function allowedOrigins(config: MbConfig): string[] {
  const options: unknown = config.options;
  const origin =
    typeof options === 'object' && options !== null
      ? (options as { origin?: unknown }).origin
      : undefined;
  const parts = typeof origin === 'string' ? [origin] : Array.isArray(origin) ? origin : [];
  return parts
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * Whether this page is one of the origins that instance answers to. An instance
 * served from this very origin needs no allowlist at all, since there is no
 * cross-origin request to refuse.
 */
function originAllowed(config: MbConfig, target: string): boolean {
  /* Reached through this page's own host: there is no cross-origin request to
     refuse, so no allowlist is involved at all. */
  if (isProxied(target)) return true;
  const here = window.location.origin;
  const list = allowedOrigins(config);
  if (list.includes('*') || list.includes(here)) return true;
  try {
    return new URL(target).origin === here;
  } catch {
    return false;
  }
}

/**
 * The command that would start this instance again, built ONLY from flags the
 * instance actually reported. A flag that is off is simply absent.
 */
function cliLine(config: MbConfig): string {
  const { options } = config;
  const origins = allowedOrigins(config);
  const parts = ['mb start'];
  if (options.port !== undefined) parts.push(`--port ${options.port}`);
  if (options.configfile) parts.push(`--configfile ${options.configfile}`);
  if (options.allowInjection) parts.push('--allowInjection');
  /* Repeated, not joined: a pipe-joined value is a single invalid origin. */
  for (const origin of origins) parts.push(`--origin "${origin}"`);
  if (options.localOnly) parts.push('--localOnly');
  /*
   * `*` is mountebank's own default, and a line headed "Started with" must not attribute
   * a default to whoever started it. Anything narrower was a decision and is shown.
   */
  if (options.ipWhitelist !== undefined && options.ipWhitelist.join('|') !== '*') {
    parts.push(`--ipWhitelist ${options.ipWhitelist.join('|')}`);
  }
  /*
   * Everything below changes the instance materially and is reported only when it was
   * given, so a line headed "Started with" has to carry it. `--datadir` decides whether
   * imposters outlive the process; `--host` decides what the admin API binds to; a custom
   * repository decides where they are kept at all.
   *
   * `--apikey` is deliberately not here: it is reported, and printing a secret into a
   * copyable line is not something a panel should do.
   */
  if (options.datadir) parts.push(`--datadir ${options.datadir}`);
  if (options.host) parts.push(`--host ${options.host}`);
  if (options.impostersRepository) {
    parts.push(`--impostersRepository ${options.impostersRepository}`);
  }
  if (options.noParse === true) parts.push('--noParse');
  if (options.mock) parts.push('--mock');
  if (options.debug) parts.push('--debug');
  return parts.join(' ');
}

/** Which sweep a maintenance button runs. */
type Sweep = 'requests' | 'proxies';

/** Shown as the button's tooltip so it is obvious which call is about to run. */
const SWEEP_CALL: Record<Sweep, string> = {
  requests: 'DELETE /imposters/:port/savedRequests',
  proxies: 'DELETE /imposters/:port/savedProxyResponses',
};

/* ═══════════════════════════════  the screen  ══════════════════════════════ */

export function Settings() {
  const params = useParams<{ env?: string }>();
  const storeEnv = useStudio((s) => s.env);
  const toast = useStudio((s) => s.toast);
  const setEnv = useStudio((s) => s.setEnv);
  const navigate = useNavigate();

  const { list, add, update, remove } = useEnvironments();
  const dropped = useEnvironments((state) => state.dropped);

  /* The URL wins when it names one of this browser's environments, so a shared
     link lands on the same instance; the store is the fallback and the first
     entry the last resort. With nothing defined there is no current environment
     at all, and this screen becomes the place one is created. */
  const environment: MbEnvironment | undefined =
    list.find((e) => e.id === params.env) ?? list.find((e) => e.id === storeEnv) ?? list[0];
  const env = environment?.id;

  /* Both dialogs hold an id, not a record, so an edit saved from the form is
     never shown against a stale copy of it. */
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<EnvId | null>(null);
  const [removingId, setRemovingId] = useState<EnvId | null>(null);

  const editing = editingId === null ? undefined : list.find((e) => e.id === editingId);
  const removing = removingId === null ? undefined : list.find((e) => e.id === removingId);

  const others = useMemo(() => list.filter((e) => e.id !== editingId), [list, editingId]);

  const origin = window.location.origin;

  /**
   * Switching keeps you on Settings; the URL leads and the store follows, so a
   * reload or a shared link lands in the same environment.
   */
  function switchTo(next: EnvId): void {
    if (next === env) return;
    setEnv(next);
    void navigate(`/${next}/settings`);
  }

  function openAdd(): void {
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(id: EnvId): void {
    setEditingId(id);
    setFormOpen(true);
  }

  function saveEnvironment(draft: EnvironmentDraft): void {
    if (editingId === null) {
      const first = list.length === 0;
      const created = add(draft);
      toast(`${created.label} added`);
      /* The first environment is also the one to work in — there is nowhere
         else to be. */
      if (first) switchTo(created.id);
    } else {
      update(editingId, draft);
      toast(`${draft.label.trim()} updated`);
    }
    setFormOpen(false);
    setEditingId(null);
  }

  /**
   * Removing forgets a connection and nothing else. If it was the environment
   * being worked in, the panel has to move: to another environment, or out to
   * the empty state when that was the last one.
   */
  function confirmRemove(): void {
    if (removing === undefined) return;
    const rest = list.filter((e) => e.id !== removing.id);
    const wasCurrent = removing.id === env;

    remove(removing.id);
    toast(`${removing.label} removed from this browser`, 'warn');
    setRemovingId(null);

    if (!wasCurrent) return;
    const next: MbEnvironment | undefined = rest[0];
    if (next === undefined) {
      void navigate('/');
      return;
    }
    setEnv(next.id);
    void navigate(`/${next.id}/settings`);
  }

  return (
    <>
      <PageHead title="Settings" />

      <Strip tone="info" icon={<Icon name="cog" />} title="What you can change here">
        The environments below live in this browser only — nobody else sees them, and they are gone
        if <b>you</b> clear this site&rsquo;s data in your browser. Nothing here is written to your
        machine; the imposters are, by the instance itself. Each one names one Mountebank admin API, and nothing else: an address,
        the way you would <span className="mono">curl</span> it. How the panel gets there is not
        part of that and not a choice — if the host serving this page forwards to that instance, as
        it does for the one <span className="mono">mountebank-studio</span> starts, the call goes{' '}
        <b>through this page&rsquo;s own host</b> and nothing about the instance has to change;
        otherwise it is called <b>directly</b>, which needs that instance to allow this origin (
        <code className={styles.cmd}>mb start --origin &quot;{origin}&quot;</code>). Each
        environment&rsquo;s own <b>Reached by</b> line below says which of the two it got.
        The blocks after the environments are read from the instance you are pointed at, or act on
        it — apart from the last, which is about this panel itself. A port, a stub or whether requests are recorded belongs to an imposter and
        is edited on that imposter&rsquo;s own screen.
      </Strip>

      {/* ───────────────────────  the environments  ─────────────────────── */}
      <Section
        title="Environments"
        icon={<Icon name="globe" />}
        tools={
          list.length === 0 ? undefined : (
            <Button size="sm" icon={<Icon name="plus" />} onClick={openAdd}>
              Add Environment
            </Button>
          )
        }
      >
        {/* What was removed on start, said somewhere it cannot expire. The toast that
            announced it lives 3.2 seconds; deleting a row somebody typed deserves a
            record that outlasts looking away. */}
        {dropped.length > 0 ? (
          <Strip tone="warn" icon={<Icon name="alert" />} title="Removed on start">
            {dropped.map((env) => `${env.label} (${env.target})`).join(', ')} —{' '}
            {dropped.length === 1 ? 'that address is' : 'those addresses are'} this page, not a
            Mountebank admin API, so {dropped.length === 1 ? 'it was' : 'they were'} dropped. An
            instance answers on its own port.
          </Strip>
        ) : null}

        {list.length === 0 ? (
          <EmptyState
            title="No environments yet"
            action={
              <Button variant="primary" icon={<Icon name="plus" />} onClick={openAdd}>
                Add Environment
              </Button>
            }
          >
            Point the panel at a Mountebank admin API — its URL and a name you will recognise.
            Nothing is sent anywhere until you do.
          </EmptyState>
        ) : (
          <div className={styles.envs} role="radiogroup" aria-label="Environment">
            {list.map((e) => (
              <div
                key={e.id}
                className={[styles.env, e.id === env ? styles.envOn : ''].filter(Boolean).join(' ')}
              >
                {/* Only the picker is a label — the row's buttons must not
                    select the environment on their way to being clicked. */}
                <label className={styles.pick} title={`Work in ${e.label}`}>
                  <input
                    type="radio"
                    name="environment"
                    className={styles.radio}
                    checked={e.id === env}
                    onChange={() => switchTo(e.id)}
                  />
                  <span className={styles.dot} />
                  <span className={styles.envName}>
                    <b>{e.label}</b>
                    <span className="mono">{e.target}</span>
                    {e.note === undefined || e.note === '' ? null : (
                      <span className={styles.note}>{e.note}</span>
                    )}
                  </span>
                </label>

                <div className={styles.envActs}>
                  <Button size="sm" onClick={() => openEdit(e.id)} title={`Edit ${e.label}`}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<Icon name="trash" />}
                    onClick={() => setRemovingId(e.id)}
                    title={`Remove ${e.label} from this browser`}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* The two blocks below are about ONE instance, so they only exist once
          there is one to be pointed at. */}
      {environment === undefined ? null : (
        <Instance key={environment.id} environment={environment} />
      )}

      <EnvironmentForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingId(null);
        }}
        environment={editing}
        others={others}
        onSave={saveEnvironment}
      />

      <Modal
        open={removing !== undefined}
        onClose={() => setRemovingId(null)}
        title={removing === undefined ? 'Remove environment?' : `Remove ${removing.label}?`}
        subtitle={removing?.target}
        footer={
          <>
            <Button onClick={() => setRemovingId(null)}>Keep It</Button>
            <Button variant="danger" icon={<Icon name="trash" />} onClick={confirmRemove}>
              Remove Environment
            </Button>
          </>
        }
      >
        <p className={styles.quiet}>
          This panel forgets how to reach it, in this browser. Nothing changes on the instance
          itself — its imposters, stubs and captured requests stay exactly as they are, and adding
          it again brings them all back.
        </p>
      </Modal>
    </>
  );
}

/* ══════════════════════  facts and actions for one instance  ═══════════════ */

interface Fact {
  label: string;
  value: ReactNode;
  mono?: boolean;
  /** One short line under the value, for a fact that needs explaining. */
  note?: string;
}

/**
 * Turning injection on, which is a restart.
 *
 * Asks twice, because it is not a display preference: an instance that accepts injection
 * runs whatever JavaScript a stub carries, with a real `require`, as the user who started
 * it. Somebody arriving at this row from a refused stub should still be told that once.
 */
function InjectionSwitch({ on, onDone }: { on: boolean; onDone: () => void }) {
  const toast = useStudio((s) => s.toast);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function go(next: boolean): Promise<void> {
    setBusy(true);
    const { ok, error } = await setInjection(next);
    setBusy(false);
    setAsking(false);
    if (!ok) {
      toast(error ?? 'The instance could not be restarted', 'err');
      return;
    }
    toast(next ? 'Injection is on — the instance restarted' : 'Injection is off again');
    onDone();
  }

  if (on) {
    return (
      <Button size="sm" onClick={() => void go(false)} disabled={busy} aria-busy={busy}>
        {busy ? 'Restarting…' : 'Turn Off'}
      </Button>
    );
  }
  return asking ? (
    <>
      <Button
        size="sm"
        variant="danger"
        icon={<Icon name="bolt" size={14} />}
        onClick={() => void go(true)}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? 'Restarting…' : 'Yes, run JavaScript from stubs'}
      </Button>
      <Button size="sm" onClick={() => setAsking(false)} disabled={busy}>
        Cancel
      </Button>
    </>
  ) : (
    <Button size="sm" icon={<Icon name="bolt" size={14} />} onClick={() => setAsking(true)}>
      Turn On
    </Button>
  );
}

/**
 * Kept a component of its own so the queries below are never asked about an
 * environment that does not exist. Same two blocks, same sweep, same preview —
 * they simply do not mount until the panel has somewhere to point.
 */
function Instance({ environment }: { environment: MbEnvironment }) {
  /* The route the panel actually takes, which may be a path this host forwards
     even though the record holds the instance's own URL. */
  const route = resolveTarget(environment.target);
  /* The instance this command started is the one served at /mb/local, whatever address
     the environment happens to spell it with. */
  const isOwnInstance = route === '/mb/local';
  const forwardedVia = isProxied(route) ? route : null;
  const env = environment.id;
  const toast = useStudio((s) => s.toast);

  const config = useConfig(env);
  const imposters = useImposters(env);
  const queryClient = useQueryClient();

  const [previewOpen, setPreviewOpen] = useState(false);

  const ports = useMemo(() => (imposters.data ?? []).map((i) => i.port), [imposters.data]);

  const previewJson = useMemo(
    () => pretty({ imposters: (imposters.data ?? []).map(imposterToMb) }),
    [imposters.data],
  );

  /**
   * Both sweeps are one action over every imposter in the environment, so they are
   * one mutation: the single toast and the single log entry cannot then drift apart
   * between them. `queries.ts` exposes the per-port clear, which would toast once
   * per imposter here.
   */
  const sweep = useMutation<number, Error, Sweep>({
    mutationFn: async (kind) => {
      for (const port of ports) {
        if (kind === 'requests') await clearRequests(env, port);
        else await clearProxyResponses(env, port);
      }
      return ports.length;
    },
    onSuccess: (count, kind) => {
      void queryClient.invalidateQueries({ queryKey: mbKeys.env(env) });
      const what = kind === 'requests' ? 'Captured requests' : 'Saved proxy responses';
      const message = `${what} cleared on ${plural(count, 'imposter')}`;
      toast(message, 'warn');
    },
    onError: (error) => toast(describeError(error), 'err'),
  });

  const pending = (kind: Sweep): boolean => sweep.isPending && sweep.variables === kind;

  /* Nothing to sweep or nothing loaded yet: the button is disabled either way and
     the `title` says which one it is. */
  const sweepBlocked = imposters.data === undefined || ports.length === 0;

  function sweepTitle(label: string): string {
    if (imposters.isPending) return 'Still reading the imposter list';
    if (imposters.isError) return 'The imposter list could not be read';
    if (ports.length === 0) return 'This environment has no imposters';
    return label;
  }

  async function copyConfig(): Promise<void> {
    try {
      await navigator.clipboard.writeText(previewJson);
      toast('Configuration copied to the clipboard');
    } catch {
      toast('The browser refused clipboard access — select the JSON and copy it by hand', 'warn');
    }
  }

  const allowed = config.isSuccess ? originAllowed(config.data, environment.target) : false;

  /*
   * The demo answers these calls from inside the page, so three of these rows would be
   * fiction: there is no origin to allow, no uptime, and no process that was started with
   * anything. Reporting a command line for a process that does not exist is exactly the
   * kind of confident wrongness the rest of this panel refuses, so the demo says what is
   * true instead — and says what the row would tell you on an instance you run.
   */
  const facts: Fact[] = DEMO_BUILD
    ? [
        {
          label: 'Version',
          value: 'mountebank 2.9.4 — the shape this demo answers in',
          mono: true,
        },
        {
          label: 'Reached by',
          value: (
            <Pill tone="ok" dot>
              answered inside this tab
            </Pill>
          ),
          note: 'Nothing is listening. On an instance you run, this row says whether the panel calls it directly or through a host that forwards to it.',
        },
        {
          label: 'Injection',
          value: <Pill dot>not applicable</Pill>,
          note: 'A real instance either allows injected JavaScript or rejects it. There is no engine here to run any.',
        },
        {
          label: 'Matched stub',
          value: <Pill dot>computed by this panel</Pill>,
          note: 'The same as against a real instance: mountebank reports the matched stub only with --debug, so the panel evaluates the predicates itself.',
        },
        {
          label: 'Captured traffic',
          value: 'seeded, so the Activity screen has something to read',
        },
      ]
    : config.isSuccess
      ? [
          { label: 'Version', value: `mountebank ${config.data.version}`, mono: true },
          {
            label: 'Config file',
            value: config.data.options.configfile ?? 'started without one',
            mono: true,
          },
          {
            label: 'Injection',
            /*
             * A startup flag, and the one somebody hits in the middle of writing a stub:
             * mountebank refuses an `inject` response outright without it and cannot be
             * told to accept one while it is running. Since this host owns the process and
             * the file everything lives in, turning it on is a restart it can perform —
             * so the row offers it rather than naming a flag and leaving.
             */
            value: (
              <span className={styles.injRow}>
                {config.data.options.allowInjection === true ? (
                  <Pill tone="ok" dot>
                    allowed
                  </Pill>
                ) : (
                  <Pill tone="warn" dot>
                    rejected
                  </Pill>
                )}
                {isOwnInstance ? (
                  <InjectionSwitch
                    on={config.data.options.allowInjection === true}
                    onDone={() => void config.refetch()}
                  />
                ) : null}
              </span>
            ),
            note:
              config.data.options.allowInjection === true
                ? 'Stubs on this instance can run JavaScript — inject responses, and the decorate and shellTransform steps. That is code execution on this machine.'
                : isOwnInstance
                  ? 'An inject response is refused while this is off, and mountebank cannot be told otherwise while it runs. Turning it on restarts the instance; the mocks are written to their file first and read back after.'
                  : 'An inject response is refused while this is off. It is a startup flag on whoever runs the instance: mb start --allowInjection.',
          },
          {
            /* `--origin` is the CORS flag; this version of mountebank has no
             allowCORS option, and `GET /config` reports the allowlist as
             `options.origin` — false when it was started without one. An
             environment reached through this origin never asks the question. */
            label: 'Reached by',
            value:
              forwardedVia !== null ? (
                <Pill tone="ok" dot>
                  this page&rsquo;s own host
                </Pill>
              ) : allowed ? (
                <Pill tone="ok" dot>
                  a direct call this instance allows
                </Pill>
              ) : (
                /* This pill only renders after a direct cross-origin read SUCCEEDED, which
                   is proof the call was allowed — by this instance or by something in
                   front of it that the panel cannot see. So it reports the reading, not a
                   verdict on the call. */
                <Pill tone="warn" dot>
                  a direct call — this instance lists no --origin for this page
                </Pill>
              ),
            ...(forwardedVia !== null
              ? {
                  note:
                    `Every request goes to ${forwardedVia} on this origin and is forwarded from there, so no --origin flag is involved.` +
                    /* Only the panel's own doing when it resolved an address to a route.
                       A path typed into the form was chosen by whoever typed it. */
                    (isProxied(environment.target)
                      ? ' This environment names that route directly.'
                      : ' The panel chose that route itself, from what this host publishes.'),
                }
              : allowed
                ? {}
                : {
                    note: 'A direct call needs this instance to allow this origin. Alternatively, have the host that serves this page forward to it — then nothing about the instance has to change.',
                  }),
          },
          {
            label: 'Matched stub',
            /*
             * Always the panel's own answer. This row used to claim "reported by
             * mountebank" on a --debug instance, which is true of the admin API and false
             * of this panel: nothing here reads the `matches` array mountebank attaches
             * under that flag. Four other screens state the rule correctly, and on a
             * --debug instance this pill contradicted every one of them.
             */
            value: <Pill dot>computed by this panel</Pill>,
            ...(config.data.options.debug === true
              ? {
                  note: 'This instance runs with --debug, so mountebank recorded the match itself. The panel does not read that yet.',
                }
              : {}),
          },
          { label: 'Uptime', value: uptimeText(config.data.process?.uptime), mono: true },
          { label: 'Started with', value: cliLine(config.data), mono: true },
        ]
      : [];

  return (
    <>
      {/* ─────────────────  read-only facts, no prose around them  ────────── */}
      <Section
        title="This instance"
        icon={<Icon name="file" />}
        tools={
          <Button
            size="sm"
            icon={<Icon name="bolt" />}
            onClick={() => void config.refetch()}
            disabled={config.isFetching}
          >
            {config.isFetching ? 'Reading…' : 'Refresh'}
          </Button>
        }
      >
        {config.isPending ? (
          <p className={styles.quiet}>Asking {environment.label} what it is running…</p>
        ) : config.isError ? (
          <p className={styles.quiet}>
            The panel could not read {environment.label}, so nothing here can be shown.{' '}
            <Failure target={environment.target} error={config.error} />
          </p>
        ) : (
          <dl className={styles.facts}>
            {facts.map((fact) => (
              <div className={styles.fact} key={fact.label}>
                <dt>{fact.label}</dt>
                <dd className={fact.mono === true ? 'mono' : undefined}>
                  {fact.value}
                  {fact.note === undefined ? null : (
                    <span className={styles.factNote}>{fact.note}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      {/* Where the mocks live, for the instance this command started. Absent for any
          other, since its persistence is not this host's to describe. */}
      {isOwnInstance ? <StoreSection /> : null}

      {/* ──────────────────────────  actions, one per row  ──────────────────── */}
      <Section title="Maintenance" icon={<Icon name="trash" />}>
        <div className={styles.rows}>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <b>Captured requests</b>
              <span>Empties the Activity screen for every imposter here.</span>
            </div>
            <Button
              onClick={() => sweep.mutate('requests')}
              disabled={sweepBlocked || sweep.isPending}
              title={sweepTitle(SWEEP_CALL.requests)}
            >
              {pending('requests') ? 'Clearing…' : 'Clear'}
            </Button>
          </div>

          <div className={styles.row}>
            <div className={styles.rowText}>
              <b>Recorded proxy stubs</b>
              <span>
                Drops what a proxy has recorded, so the next matching call goes out to the real
                service again.
              </span>
            </div>
            <Button
              onClick={() => sweep.mutate('proxies')}
              disabled={sweepBlocked || sweep.isPending}
              title={sweepTitle(SWEEP_CALL.proxies)}
            >
              {pending('proxies') ? 'Clearing…' : 'Clear'}
            </Button>
          </div>

          <div className={styles.row}>
            <div className={styles.rowText}>
              <b>Full configuration</b>
              <span>
                See every imposter here as one JSON document, in the shape <code>--configfile</code>{' '}
                expects.
              </span>
            </div>
            <Button
              onClick={() => setPreviewOpen(true)}
              disabled={imposters.data === undefined}
              title={
                imposters.data === undefined ? 'The imposter list has not been read yet' : undefined
              }
            >
              View
            </Button>
          </div>
        </div>
      </Section>

      {/* ─────────────────────────  what this panel is  ─────────────────────
          Its own version, because the first question on any bug report is which
          one you are running, and until this block existed the panel could only
          answer for the mountebank it was pointed at.

          The independence line is the same sentence as NOTICE and the README,
          deliberately word for word: the name describes what this connects to and
          claims nothing more, and that should read the same wherever somebody
          meets it. */}
      <Section title="This panel" icon={<Icon name="code" />}>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Version</dt>
            <dd className="mono">mountebank-studio {__APP_VERSION__}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Licence</dt>
            <dd>
              <a
                className={styles.link}
                href="https://github.com/gokhanibrikci/mountebank-studio/blob/main/LICENSE"
                target="_blank"
                rel="noreferrer"
              >
                Apache-2.0
              </a>
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Source</dt>
            <dd>
              <a
                className={styles.link}
                href="https://github.com/gokhanibrikci/mountebank-studio"
                target="_blank"
                rel="noreferrer"
              >
                github.com/gokhanibrikci/mountebank-studio
              </a>
              <span className={styles.factNote}>Issues and pull requests are welcome there.</span>
            </dd>
          </div>
        </dl>

        <p className={styles.independence}>
          An independent project. It is not affiliated with, endorsed by, or sponsored by the{' '}
          <a className={styles.link} href="https://www.mbtest.dev" target="_blank" rel="noreferrer">
            mountebank
          </a>{' '}
          project. Mountebank is MIT-licensed, and no part of it is copied into this panel: it is a
          dependency, installed from npm and started as its own process — or an instance you
          already run, if you point this at one.
        </p>
      </Section>

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Full configuration"
        subtitle={`${environment.label} · ${plural(ports.length, 'imposter')}`}
        footer={
          <>
            <Button icon={<Icon name="copy" />} onClick={() => void copyConfig()}>
              Copy JSON
            </Button>
            <Button variant="primary" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
          </>
        }
      >
        <CodeEditor value={previewJson} language="json" height={420} readOnly />
      </Modal>
    </>
  );
}

export default Settings;
