/**
 * The things you can CHANGE about the instance this command started, in one card.
 *
 * They used to be scattered: the file the mocks live in had a section of its own, and the
 * switch for injected JavaScript sat inside the read-only table of facts, between a version
 * string and an uptime. Nothing said which of those you could touch. Now the card is the
 * answer to "what can I change here", and the table below it is the answer to "what is
 * true" — a control never appears in the second, and a fact never appears alone in the
 * first.
 *
 * Only for the instance this host started. Somebody else's persists however they set it up
 * and takes its flags from whoever runs it, so for those the card is absent rather than
 * offering to do something it cannot.
 */

import { useEffect, useState } from 'react';

import { ago } from '../lib/format';
import { fileSize, moveStore, readStore, setInjection, type StoreState } from '../lib/mb/store';
import { useStudio } from '../store/useStudio';
import { Button, Field, Icon, Input, Section, Strip } from '../ui';
import styles from './Settings.module.css';

export interface LocalSettingsProps {
  /** Whether the instance currently accepts injected JavaScript, read from `GET /config`. */
  injectionAllowed: boolean;
  /** Re-read the instance after a restart, so the facts below this card agree with it. */
  onInstanceChanged: () => void;
}

export function LocalSettings({ injectionAllowed, onInstanceChanged }: LocalSettingsProps) {
  const toast = useStudio((s) => s.toast);
  const [state, setState] = useState<StoreState | null>(null);

  /* ---- the file ---- */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* ---- injection ---- */
  const [asking, setAsking] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readStore().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* Not served by a host that owns an instance — a static build, or a dev server. */
  if (state === null) return null;

  if (!state.kept) {
    return (
      <Section title="Instance settings" icon={<Icon name="cog" />}>
        <p className={styles.note}>
          There is nothing to change here: {state.reason}. What an instance somebody else runs
          keeps, and which flags it was started with, belong to whoever runs it.
        </p>
      </Section>
    );
  }

  async function moveTo(): Promise<void> {
    setSaving(true);
    setProblem(null);
    const { state: next, error } = await moveStore(draft);
    setSaving(false);
    if (error !== null || next === null) {
      setProblem(error ?? 'That path could not be used.');
      return;
    }
    setState(next);
    setEditing(false);
    toast('Mocks are kept here from now on');
  }

  async function switchInjection(next: boolean): Promise<void> {
    setRestarting(true);
    const { ok, error } = await setInjection(next);
    setRestarting(false);
    setAsking(false);
    if (!ok) {
      toast(error ?? 'The instance could not be restarted', 'err');
      return;
    }
    toast(next ? 'Injection is on — the instance restarted' : 'Injection is off again');
    onInstanceChanged();
    void readStore().then(setState);
  }

  return (
    <Section title="Instance settings" icon={<Icon name="cog" />}>
      {state.loadFailed === null ? null : (
        <Strip
          tone="err"
          icon={<Icon name="alert" />}
          title="These mocks are on disk but not running"
        >
          Mountebank would not start with <span className="mono">{state.path}</span>:{' '}
          {state.loadFailed}. It is running empty instead, and nothing will be written over that
          file meanwhile — so the mocks are safe, they are just not answering.{' '}
          {/injection/i.test(state.loadFailed)
            ? 'Turning on injected JavaScript below restarts the instance and loads them.'
            : 'Fix the file, or point somewhere else, and the next start will load it.'}
        </Strip>
      )}

      <div className={styles.rows}>
        {/* ─────────────────────  where the mocks are kept  ───────────────────── */}
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>Where these mocks are kept</b>
            <span>
              Every imposter, stub and response on this instance is one JSON file, read when it
              starts and rewritten whenever anything changes.
            </span>
            <span className={styles.settingValue}>
              <code>{state.path}</code>{' '}
              {state.exists ? (
                <>
                  · {fileSize(state.bytes)} ·{' '}
                  {state.savedAt === null ? 'not written this run' : `written ${ago(state.savedAt)}`}
                </>
              ) : (
                <>· not written yet — nothing has changed here</>
              )}
            </span>
          </div>
          {editing ? null : (
            <Button
              onClick={() => {
                setDraft(state.kept ? state.path : '');
                setProblem(null);
                setEditing(true);
              }}
            >
              Change
            </Button>
          )}
        </div>

        {editing ? (
          <div className={styles.settingEdit}>
            <Field
              label="File"
              hint={`An absolute path, or one relative to ${state.cwd}. The mocks you have now are written there before it takes effect, and the choice is remembered for the next run.`}
            >
              <Input
                mono
                autoFocus
                value={draft}
                placeholder="./mocks.json"
                disabled={saving}
                onChange={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void moveTo();
                }}
              />
            </Field>
            {problem === null ? null : (
              <Strip tone="err" icon={<Icon name="alert" />} title="That path was refused">
                {problem}
              </Strip>
            )}
            <div className={styles.settingActs}>
              <Button onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={<Icon name="save" size={14} />}
                onClick={() => void moveTo()}
                disabled={saving || draft.trim() === ''}
                aria-busy={saving}
              >
                {saving ? 'Moving…' : 'Keep Them Here'}
              </Button>
            </div>
          </div>
        ) : null}

        {/* ─────────────────────  injected JavaScript  ───────────────────── */}
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>Injected JavaScript</b>
            <span>
              {injectionAllowed
                ? 'Stubs on this instance can run JavaScript — inject responses, and the decorate and shellTransform steps. That is code execution on this machine, as you.'
                : 'An inject response is refused while this is off, and Mountebank cannot be told otherwise while it runs. Turning it on restarts the instance; the mocks are written to their file first and read back after.'}
            </span>
            <span className={styles.settingValue}>
              <code>{injectionAllowed ? '--allowInjection' : 'off'}</code>
            </span>
          </div>
          {injectionAllowed ? (
            <Button
              onClick={() => void switchInjection(false)}
              disabled={restarting}
              aria-busy={restarting}
            >
              {restarting ? 'Restarting…' : 'Turn Off'}
            </Button>
          ) : asking ? (
            <div className={styles.settingActs}>
              <Button onClick={() => setAsking(false)} disabled={restarting}>
                Cancel
              </Button>
              <Button
                variant="danger"
                icon={<Icon name="bolt" size={14} />}
                onClick={() => void switchInjection(true)}
                disabled={restarting}
                aria-busy={restarting}
              >
                {restarting ? 'Restarting…' : 'Yes, run JavaScript from stubs'}
              </Button>
            </div>
          ) : (
            <Button icon={<Icon name="bolt" size={14} />} onClick={() => setAsking(true)}>
              Turn On
            </Button>
          )}
        </div>
      </div>

      {state.error === null ? null : (
        <Strip tone="err" icon={<Icon name="alert" />} title="The last save failed">
          {state.error} — what is on screen is running, but it is not on disk.
        </Strip>
      )}
    </Section>
  );
}

export default LocalSettings;
