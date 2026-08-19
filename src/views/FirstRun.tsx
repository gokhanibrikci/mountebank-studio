/**
 * Welcome — the screen that stands in for the whole app until the panel has been
 * pointed at something.
 *
 * It is a full-width screen and not a modal, on purpose: with no environment
 * there is no imposter list behind it to dismiss it back to, and the two things
 * it has to say (add an instance, and start that instance so it will answer this
 * page) are prerequisites rather than an interruption.
 *
 * Adding happens HERE — the form opens over this screen and the environment
 * appears as a row underneath, so several instances can be entered in one sitting
 * without bouncing to Settings and back. That also means the shell becomes
 * reachable the moment the first row exists, which is why the screen is held open
 * (`useStudio().welcome`) until Start is pressed rather than flipping out from
 * under whoever is still typing.
 *
 * It is ONE card, and deliberately so. The prerequisite, the list and the way in
 * are three parts of a single act of setting the panel up; as separate cards they
 * read as separate errands, and Start ended up stranded under a block it has
 * nothing to do with. So the prerequisite is a strip at the top of the card — the
 * shape used for a screen's standing explanation everywhere else — the rows are
 * the card's body, and Start is its footer.
 *
 * The `--origin` line is built from `window.location.origin` rather than written
 * out, because the only correct value is wherever this panel is actually being
 * served from — which is different on a laptop, a shared host and a preview.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import type { EnvId, MbEnvironment } from '../lib/environments';
import { plural } from '../lib/format';
import { useReach } from '../lib/mb/reach';
import { useEnvironments, type EnvironmentDraft } from '../store/useEnvironments';
import { useStudio } from '../store/useStudio';
import { Button, Icon, Modal, PageHead, Pill, Section, Strip } from '../ui';
import { EnvironmentForm } from './EnvironmentForm';
import styles from './FirstRun.module.css';

export interface SoloFrameProps {
  children: ReactNode;
}

/**
 * The frame for a screen that has no environment to sit under. There is no rail,
 * no topbar and no command palette, because not one of them can name an instance
 * yet. It keeps the shell's measure and owns its own scrolling, so a short
 * viewport scrolls the page instead of clipping it.
 */
export function SoloFrame({ children }: SoloFrameProps) {
  return (
    <main className={`content ${styles.solo}`} tabIndex={-1}>
      <div className={styles.wrap}>{children}</div>
    </main>
  );
}

export function FirstRun() {
  const navigate = useNavigate();
  const toast = useStudio((s) => s.toast);
  const setEnv = useStudio((s) => s.setEnv);
  const setWelcome = useStudio((s) => s.setWelcome);
  const setGreeted = useStudio((s) => s.setGreeted);
  const { list, add, update, remove } = useEnvironments();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<EnvId | null>(null);
  const [removingId, setRemovingId] = useState<EnvId | null>(null);
  const [pickedId, setPickedId] = useState<EnvId | null>(null);

  const editing = editingId === null ? undefined : list.find((e) => e.id === editingId);
  const removing = removingId === null ? undefined : list.find((e) => e.id === removingId);
  const others = useMemo(() => list.filter((e) => e.id !== editingId), [list, editingId]);

  /** What Start will open. The last one added leads until another row is picked. */
  const picked: MbEnvironment | undefined =
    list.find((e) => e.id === pickedId) ?? (list.length > 0 ? list[0] : undefined);

  /*
   * What this page can promise depends on what serves it. Served by
   * `npx mountebank-studio`, the host will fetch an instance that refuses this page, so no
   * flag is involved anywhere and saying otherwise sends people to change something that
   * did not need changing. Served as a static build, the flag really is the answer.
   */
  const canForward = useReach((s) => s.forwarding?.enabled === true);
  const loadForwarding = useReach((s) => s.loadForwarding);
  useEffect(() => {
    void loadForwarding();
  }, [loadForwarding]);

  const command = `mb start --origin "${window.location.origin}"`;
  /* For someone who has no instance at all: npx needs no install and no config. */
  const startCommand = canForward
    ? 'npx @mbtest/mountebank@2.9.4'
    : `npx @mbtest/mountebank@2.9.4 --origin "${window.location.origin}"`;

  function openAdd(): void {
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(id: EnvId): void {
    setEditingId(id);
    setFormOpen(true);
  }

  function closeForm(): void {
    setFormOpen(false);
    setEditingId(null);
  }

  function saveEnvironment(draft: EnvironmentDraft): void {
    /* Keep this screen: the first row makes the shell available, and the panel
       must not navigate away from someone who is still adding instances. */
    setWelcome(true);

    if (editingId === null) {
      const created = add(draft);
      setPickedId(created.id);
      toast(`${created.label} added`);
    } else {
      update(editingId, draft);
      toast(`${draft.label.trim()} updated`);
    }
    closeForm();
  }

  function confirmRemove(): void {
    if (removing === undefined) return;
    remove(removing.id);
    if (removing.id === pickedId) setPickedId(null);
    toast(`${removing.label} removed from this browser`, 'warn');
    setRemovingId(null);
  }

  /** Into the panel proper. The URL leads and the store follows, as everywhere else. */
  function start(): void {
    if (picked === undefined) return;
    setEnv(picked.id);
    setWelcome(false);
    setGreeted(true);
    void navigate(`/${picked.id}/overview`);
  }

  const copyStart = (): Promise<void> => copy(startCommand);
  const copyCommand = (): Promise<void> => copy(command);

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast('Command copied to the clipboard');
    } catch {
      toast(
        'The browser refused clipboard access — select the command and copy it by hand',
        'warn',
      );
    }
  }

  const many = list.length > 1;

  return (
    <SoloFrame>
      <PageHead
        eyebrow="Welcome"
        title="Mountebank Studio"
        sub="Any Mountebank instance: imposters, stubs, captured traffic."
      />

      <Section
        title="Environments"
        icon={<Icon name="globe" />}
        badge={list.length === 0 ? undefined : <Pill>{plural(list.length, 'instance')}</Pill>}
        /* One door, top right, wherever the screen is in its life — an empty list
           used to put a lone primary button in the middle of the prose instead. */
        tools={
          <Button
            variant={list.length === 0 ? 'primary' : 'default'}
            size="sm"
            icon={<Icon name="plus" />}
            onClick={openAdd}
          >
            Add Environment
          </Button>
        }
      >
        <p className={styles.copy}>
          An environment is one Mountebank instance for the panel to point at: a name, and the URL
          of its admin API. The list is kept in this browser only — not on a server, and not in the
          build.
        </p>

        {list.length === 0 ? null : (
          <div className={styles.envs} role="radiogroup" aria-label="Environment to open">
            {list.map((e) => (
              <div
                key={e.id}
                className={[styles.env, e.id === picked?.id ? styles.envOn : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                {/* Only the picker is a label, so the row's own buttons cannot
                    change which environment Start opens on their way to a click. */}
                <label className={styles.pick} title={`Open ${e.label} when you start`}>
                  <input
                    type="radio"
                    name="welcome-environment"
                    className={styles.radio}
                    checked={e.id === picked?.id}
                    onChange={() => setPickedId(e.id)}
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

        {/*
         * Not step one, which is how it read at the top of the card: nothing here
         * has to be done before adding anything, and the flag belongs to whoever
         * runs that instance — often not the person opening this panel. It is the
         * reason a connection fails, so it is written as that, and the panel says
         * the same thing again at the moment it actually happens.
         */}
        <Strip
          flush
          icon={<Icon name="bolt" />}
          title={canForward ? 'If an instance refuses this page' : 'If an instance will not answer'}
          actions={
            canForward ? undefined : (
              <Button size="sm" icon={<Icon name="copy" />} onClick={() => void copyCommand()}>
                Copy
              </Button>
            )
          }
        >
          {canForward ? (
            <>
              It does not have to answer this page directly. Paste any address: if the instance is up
              but was not started with an <code className={styles.cmd}>--origin</code> that allows
              this page, the host serving the panel fetches it and passes it on — which is not a
              cross-origin request at all. Nothing about that instance changes, and no flag is
              involved anywhere. <b>Test Connection</b> reports which route it will use.
            </>
          ) : (
            <>
              A full URL is read straight from your browser, so that instance has to allow this page —
              the flag goes wherever Mountebank runs, not here:{' '}
              <code className={styles.cmd}>{command}</code>. For an instance you cannot restart, give
              a path instead (<code className={styles.cmd}>/mb/stage</code>) and let this page&rsquo;s
              own host forward it: nothing is cross-origin then, and that instance stays untouched.{' '}
              <b>Test Connection</b> tells you which of the two you are looking at.
            </>
          )}
        </Strip>

        {picked === undefined ? null : (
          <div className={styles.startBar}>
            <p className={styles.startNote}>
              {many
                ? `Start opens ${picked.label} — switch any time from the header.`
                : `Start opens ${picked.label}. More can be added later in Settings.`}
            </p>
            <Button variant="primary" icon={<Icon name="dash" />} onClick={start}>
              Start
            </Button>
          </div>
        )}
      </Section>

      {/*
       * Below the action: what Mountebank actually is, what this panel does with
       * it, and how to get an instance if there is none. A first-run screen that
       * only holds a form teaches nothing, and this is the one moment someone is
       * certain to be reading.
       */}
      <Section title="How a mock is put together" icon={<Icon name="imps" />}>
        <ol className={styles.steps}>
          <li>
            <b>An imposter</b> is one mock server on one port. Point the service under test at that
            port and it talks to Mountebank instead of the real thing. Ports are how imposters are
            told apart, so two can never share one.
          </li>
          <li>
            <b>A stub</b> decides what that imposter answers. Its predicates say <em>when</em> it
            applies — method, path, a header, a field in the body. Stubs are matched top to bottom
            and the first one that fits wins, so the rest never see the request.
          </li>
          <li>
            <b>A response</b> is what comes back: a canned status and body, a proxy that forwards to
            the real service and records what it said, or injected JavaScript when the instance
            allows it.
          </li>
        </ol>
      </Section>

      <Section title="What this panel gives you" icon={<Icon name="dash" />}>
        <div className={styles.feats}>
          <div className={styles.feat}>
            <Icon name="imps" />
            <b>Imposters</b>
            <span>Create, duplicate and delete them, and see which ports are live.</span>
          </div>
          <div className={styles.feat}>
            <Icon name="filter" />
            <b>Predicates</b>
            <span>
              A plain form for method, path, query, headers and body — or the full operator set when
              you need it.
            </span>
          </div>
          <div className={styles.feat}>
            <Icon name="reqs" />
            <b>Responses</b>
            <span>Canned answers, proxy recording, or injection, with delays and repeats.</span>
          </div>
          <div className={styles.feat}>
            <Icon name="act" />
            <b>Captured traffic</b>
            <span>Every request an imposter recorded, next to the stub that answered it.</span>
          </div>
          <div className={styles.feat}>
            <Icon name="code" />
            <b>Raw JSON</b>
            <span>Every editor flips to JSON and back without losing anything you wrote.</span>
          </div>
          <div className={styles.feat}>
            <Icon name="save" />
            <b>Whole-config writes</b>
            <span>Send an entire imposter set to an instance in one deliberate write.</span>
          </div>
        </div>
      </Section>

      <Section
        title={list.length === 0 ? 'No Mountebank running yet?' : 'Starting another one'}
        icon={<Icon name="bolt" />}
        tools={
          <Button size="sm" icon={<Icon name="copy" />} onClick={() => void copyStart()}>
            Copy
          </Button>
        }
      >
        <p className={styles.copy}>
          {list.length === 0
            ? 'One command starts one. It needs Node and nothing else, and it leaves nothing behind when you stop it.'
            : 'One command starts another, on a port of its own. It needs Node and nothing else, and it leaves nothing behind when you stop it.'}
        </p>
        <pre className={styles.cmdBlock}>
          <code>{startCommand}</code>
        </pre>
        <p className={styles.copy}>
          Then add <span className="mono">http://localhost:2525</span> above.{' '}
          {canForward
            ? /* The command above carries no --origin, and this is why: the flag would answer
                 a question this host has already taken off the table. */
              'It does not need to allow this page — this host fetches it for you.'
            : 'The command allows this page, which a browser requires before the panel can read it.'}{' '}
          Mountebank&rsquo;s own documentation lives at{' '}
          <a
            className={styles.link}
            href="https://www.mbtest.dev/"
            target="_blank"
            rel="noreferrer"
          >
            mbtest.dev
          </a>
          .
        </p>
      </Section>

      <EnvironmentForm
        open={formOpen}
        onClose={closeForm}
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
        <p className={styles.copy}>
          This forgets the connection in this browser. The instance itself, and every imposter on
          it, are left exactly as they are.
        </p>
      </Modal>
    </SoloFrame>
  );
}
