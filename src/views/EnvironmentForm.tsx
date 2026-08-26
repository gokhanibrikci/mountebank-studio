/**
 * Add or edit an environment.
 *
 * An environment is not a build-time constant any more: it is a record the user
 * creates here and this browser keeps (src/store/useEnvironments.ts). So this
 * modal is the whole authoring surface for one — the name it is known by, the
 * admin API it points at, how loudly the panel should mark it, and whether the
 * panel may write to it at all.
 *
 * Two things it exists to get right:
 *
 *  1. VALIDATION IS SHARED. `validate()` in src/lib/environments is the one
 *     authority on what a savable environment is — the seed reader uses it too.
 *     This screen only decides *where* each message is shown, never what counts
 *     as an error.
 *
 *  2. TESTING HAPPENS BEFORE SAVING. The panel calls each admin API directly from
 *     the browser, so a typed URL can fail in a way no amount of validation can
 *     predict: nothing listening, wrong port, or an instance that was not started
 *     with `--origin` allowing this page. Test answers that question against the
 *     URL in the field, with a throwaway axios client — the environment does not
 *     exist yet, so client.ts (which resolves a *saved* environment by id) cannot
 *     be used, and adding the record first just to probe it would leave junk
 *     behind on every failed attempt.
 */

import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import axios from 'axios';

import { isProxied, normalise, validate, type MbEnvironment } from '../lib/environments';
import { describeError } from '../lib/mb/client';
import { resolveTarget, respondsAtAll, useReach } from '../lib/mb/reach';
import type { MbConfig } from '../lib/mb/types';
import type { EnvironmentDraft } from '../store/useEnvironments';
import { useStudio } from '../store/useStudio';
import { Button, Field, Icon, Input, Modal, Off } from '../ui';
import styles from './EnvironmentForm.module.css';

/** A probe is short — nobody waits 20s to learn a host is not there. */
const PROBE_TIMEOUT_MS = 8_000;

/**
 * What the instance said when Test asked it. Three outcomes, because those are
 * the three the user has to tell apart:
 *   reachable — it answered as a mountebank, and here is which one
 *   refused   — it answered, but not with a config (auth, wrong path, a gateway)
 *   silent    — no answer a browser is willing to hand back to a script
 */
type Probe =
  | { kind: 'testing' }
  | {
      kind: 'reachable';
      version: string | null;
      injection: boolean;
      via?: string;
      /** True when THIS test is what made `via` exist: the host was asked, and agreed. */
      arranged?: boolean;
    }
  | { kind: 'refused'; status: string; detail?: string }
  /** The instance answered, but not to this page: --origin does not list it. */
  | { kind: 'blocked' }
  | { kind: 'silent' };

export interface EnvironmentFormProps {
  open: boolean;
  onClose: () => void;
  /** The environment being changed, or undefined when adding a new one. */
  environment?: MbEnvironment;
  /**
   * Every OTHER environment. `validate()` refuses a target that is already
   * pointed at, and editing an environment must not collide with itself.
   */
  others: MbEnvironment[];
  /** Called with a savable draft. The store mints the id and trims the fields. */
  onSave: (draft: EnvironmentDraft) => void;
}

export function EnvironmentForm({
  open,
  onClose,
  environment,
  others,
  onSave,
}: EnvironmentFormProps) {
  const toast = useStudio((s) => s.toast);

  const ids = useId();
  const nameId = `${ids}-name`;
  const targetId = `${ids}-target`;
  const noteId = `${ids}-note`;
  const nameErrId = `${ids}-name-err`;
  const targetErrId = `${ids}-target-err`;

  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [probe, setProbe] = useState<Probe | null>(null);

  /**
   * A message is shown once its field has been left, never while it is being
   * typed for the first time — an empty Add form that already complains about
   * both fields is noise, not help.
   */
  const [touched, setTouched] = useState<{ label: boolean; target: boolean }>({
    label: false,
    target: false,
  });

  /* Every opening starts from the record being edited, or from empty. */
  useEffect(() => {
    if (!open) return;
    setLabel(environment?.label ?? '');
    setTarget(environment?.target ?? '');
    setNote(environment?.note ?? '');
    setProbe(null);
    setTouched({ label: false, target: false });
  }, [open, environment]);

  const errors = validate({ label, target }, others);
  /* What the panel will actually call: the URL, or the path this host forwards to
     that same instance on. Shown so the form reports the real route. */
  const route = resolveTarget(normalise(target));
  const forwarded = route !== normalise(target) ? route : null;
  /* A path target is reached through this origin, so half of what this form has to
     say about permission does not apply to it. */
  const proxied = isProxied(normalise(target));
  const canSave = Object.keys(errors).length === 0;
  const labelError = touched.label ? errors.label : undefined;
  const targetError = touched.target ? errors.target : undefined;
  const testing = probe?.kind === 'testing';

  const origin = window.location.origin;
  const command = `mb start --origin "${origin}"`;

  function submit(): void {
    if (!canSave) return;
    onSave({
      label: label.trim(),
      target: normalise(target),
      /*
       * Recorded whenever the test read it through this origin — whether this test is
       * what arranged that or the route already existed. What matters after a restart is
       * that the panel knows to ask again, and "who registered it first" does not change
       * that. A host that forwards permanently (nginx) simply says it takes no
       * registrations, and asking costs one refused request.
       */
      ...(probe?.kind === 'reachable' && probe.via !== undefined && !proxied
        ? { forwarded: true }
        : {}),
      /* Always sent, so clearing the note actually clears it on an edit. */
      note: note.trim(),
    });
  }

  /** Enter anywhere in the form saves, as it would in a native form. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  }

  async function test(): Promise<void> {
    /* Test needs a URL, so it is also the moment both messages become fair. */
    setTouched({ label: true, target: true });
    if (errors.target !== undefined) return;

    setProbe({ kind: 'testing' });
    try {
      const client = axios.create({
        baseURL: route,
        timeout: PROBE_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
      });
      const { data } = await client.get<MbConfig>('/config');
      setProbe({
        kind: 'reachable',
        version: typeof data.version === 'string' && data.version !== '' ? data.version : null,
        injection: data.options?.allowInjection === true,
        ...(forwarded === null ? {} : { via: forwarded }),
      });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const status = `${error.response.status} ${error.response.statusText}`.trim();
        const detail = describeError(error);
        setProbe({ kind: 'refused', status, ...(detail === status ? {} : { detail }) });
        return;
      }
      /*
       * No response object at all. A normal fetch cannot tell a refused origin
       * from a dead host — both surface as the same opaque failure. A no-cors
       * probe can: the browser still performs the request and hands back an
       * opaque response when the server answered, and only rejects when nothing
       * was reachable. So one extra request turns a three-way guess into a fact.
       */
      const answered = await respondsAtAll(route); /* shared with every error surface */
      if (!answered) {
        setProbe({ kind: 'silent' });
        return;
      }
      /*
       * Up, and refusing this page. Telling somebody to add `--origin` to an instance
       * they may not run is the last resort, not the first: the host serving this panel
       * can fetch it and pass it on, and asking costs one same-origin request. If it
       * agrees, the address stays exactly as typed and the route changes underneath.
       */
      const { loadForwarding, askForward } = useReach.getState();
      await loadForwarding();
      if (useReach.getState().forwarding?.enabled === true) {
        const arranged = await askForward(normalise(target));
        if (arranged !== null) {
          try {
            const viaHost = axios.create({
              baseURL: arranged,
              timeout: PROBE_TIMEOUT_MS,
              headers: { 'Content-Type': 'application/json' },
            });
            const { data } = await viaHost.get<MbConfig>('/config');
            setProbe({
              kind: 'reachable',
              version:
                typeof data.version === 'string' && data.version !== '' ? data.version : null,
              injection: data.options?.allowInjection === true,
              via: arranged,
              arranged: true,
            });
            return;
          } catch {
            /* The host took the request but could not read it either. Say what is true
               below rather than claiming a route that does not work. */
          }
        }
      }

      setProbe({ kind: 'blocked' });
    }
  }

  async function copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
      toast('Command copied to the clipboard');
    } catch {
      toast(
        'The browser refused clipboard access — select the command and copy it by hand',
        'warn',
      );
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={environment === undefined ? 'Add Environment' : 'Edit Environment'}
      subtitle={
        environment === undefined
          ? 'One Mountebank admin API, remembered in this browser.'
          : `/${environment.id} · remembered in this browser`
      }
      footer={
        <>
          <Button icon={<Icon name="bolt" />} onClick={() => void test()} disabled={testing}>
            {testing ? 'Testing…' : 'Test Connection'}
          </Button>
          <div className={styles.spacer} />
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={<Icon name="check" />}
            onClick={submit}
            disabled={!canSave}
            /* Four of validate()'s errors happen with both fields filled — a duplicate
               target, this page's own origin, an unparseable URL, a non-http scheme — and
               this tooltip used to tell somebody to do what they had already done. */
            title={canSave ? undefined : (errors.target ?? errors.label)}
          >
            {environment === undefined ? 'Add Environment' : 'Save Environment'}
          </Button>
        </>
      }
    >
      <div className={styles.form} onKeyDown={onKeyDown}>
        <Field
          label="Name"
          htmlFor={nameId}
          hint={
            labelError === undefined ? undefined : (
              <span id={nameErrId}>
                <Off>{labelError}</Off>
              </span>
            )
          }
        >
          <Input
            id={nameId}
            placeholder="Orders — staging"
            value={label}
            aria-invalid={labelError !== undefined}
            aria-describedby={labelError === undefined ? undefined : nameErrId}
            onChange={(e) => setLabel(e.currentTarget.value)}
            onBlur={() => setTouched((t) => ({ ...t, label: true }))}
          />
        </Field>

        <Field
          label="Admin API"
          htmlFor={targetId}
          hint={
            targetError === undefined ? (
              proxied ? (
                <>
                  A path on this origin, so the request never leaves it: whatever serves this page
                  forwards <code className={styles.inline}>{normalise(target)}</code> to the
                  instance. Nothing has to be allowed, and the instance needs no flag.
                </>
              ) : (
                <>
                  The full URL of Mountebank&rsquo;s admin port, usually 2525. If the host serving
                  this page forwards to that instance, the panel uses that route by itself and the
                  instance needs nothing; otherwise the call is direct and the instance has to allow
                  this origin.
                </>
              )
            ) : (
              <span id={targetErrId}>
                <Off>{targetError}</Off>
              </span>
            )
          }
        >
          <Input
            id={targetId}
            mono
            inputMode="url"
            placeholder="https://mountebank.example.com"
            value={target}
            aria-invalid={targetError !== undefined}
            aria-describedby={targetError === undefined ? undefined : targetErrId}
            onChange={(e) => {
              setTarget(e.currentTarget.value);
              /* A result belongs to the URL it was asked about. */
              setProbe(null);
            }}
            onBlur={() => setTouched((t) => ({ ...t, target: true }))}
          />
        </Field>

        {probe === null ? null : (
          <ProbeResult probe={probe} onCopy={() => void copyCommand()} command={command} />
        )}

        <Field label="Note" htmlFor={noteId} hint="Optional. Shown next to the environment.">
          <Input
            id={noteId}
            maxLength={80}
            placeholder="Shared with the integration team"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

/* ─────────────────────────────  the test result  ───────────────────────── */

/** One block, one outcome, in plain words. It never guesses beyond the answer. */
function ProbeResult({
  probe,
  command,
  onCopy,
}: {
  probe: Probe;
  command: string;
  onCopy: () => void;
}) {
  /*
   * The question this control is asked is always the same one: IS IT UP? So every
   * verdict answers that in its first three words, and anything else — a version, a
   * missing permission, a status code — follows as detail. An earlier wording led
   * with the CORS caveat, which left the actual answer buried and unclear.
   */
  let tone = styles.quiet;
  let icon: ReactNode = <Icon name="clock" size={14} />;
  let head = 'Asking the instance…';
  let body: ReactNode = null;

  if (probe.kind === 'reachable') {
    tone = styles.ok;
    icon = <Icon name="check" size={14} />;
    head =
      probe.version === null ? 'Something is up, but it is not Mountebank' : 'Mountebank is up';
    body =
      probe.version === null ? (
        <p>
          It answered, but not with a Mountebank configuration. Check that the URL points at the
          admin port rather than at an imposter.
        </p>
      ) : (
        <p>
          Version {probe.version}, read{' '}
          {probe.via === undefined
            ? 'directly'
            : probe.arranged === true
              ? /* It refused this page, so this host was asked to fetch it instead. Worth
                   saying plainly: the address is unchanged, the route is new. */
                `through this host, which now forwards to it at ${probe.via}`
              : `through ${probe.via}`}{' '}
          — nothing else to do. Injection is {probe.injection ? 'allowed' : 'rejected'} on this
          instance.
        </p>
      );
  } else if (probe.kind === 'refused') {
    tone = styles.warn;
    icon = <Icon name="alert" size={14} />;
    head = `Something is up, but it answered ${probe.status}`;
    body = (
      <p>
        It is reachable from this page and it did not return a configuration, so the URL may point
        at something other than a Mountebank admin port — or the instance wants an API key, which
        this panel cannot send.{probe.detail === undefined ? '' : ` ${probe.detail}`}
      </p>
    );
  } else if (probe.kind === 'blocked') {
    tone = styles.warn;
    icon = <Icon name="alert" size={14} />;
    /* Nothing on this path proves it is Mountebank: `blocked` comes from a no-cors probe
       whose reply cannot be read at all — not the body, not the status, not a header. */
    head = 'Something is up — but it will not answer this page';
    body = (
      <>
        <p>
          Something answered at that address, so you can save this environment as it is. The
          panel cannot read it, though: this host does not forward to that instance, so the call
          is cross-origin and the instance has to allow this page.
        </p>
        <div className={styles.cmd}>
          <code>{command}</code>
          <Button size="sm" icon={<Icon name="copy" />} onClick={onCopy}>
            Copy
          </Button>
        </div>
      </>
    );
  } else if (probe.kind === 'silent') {
    tone = styles.err;
    icon = <Icon name="x" size={14} />;
    head = 'Nothing is up at that address';
    body = (
      <p>
        Nothing replied at all, so this is the URL or the instance rather than a permission: check
        that it is running, and that the host and port are right — the admin port is usually{' '}
        <code>2525</code>, not the port an imposter answers on.
      </p>
    );
  }

  return (
    <div className={[styles.result, tone].filter(Boolean).join(' ')} role="status">
      {icon}
      <div className={styles.resultBody}>
        <b>{head}</b>
        {body}
      </div>
    </div>
  );
}

export default EnvironmentForm;
