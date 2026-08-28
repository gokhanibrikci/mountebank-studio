/**
 * Where this host keeps the mocks, and moving it.
 *
 * Everything the instance holds lives in one JSON file: the host reads it at startup and
 * rewrites it whenever anything changes. That makes the path a real setting — a project
 * directory, a shared folder, next to the tests it feeds — rather than something buried
 * in a home directory nobody looks in.
 *
 * Shown only for the instance this command started, since it is the only one whose
 * persistence this host owns. Pointed at somebody else's, the section is absent rather
 * than wrong.
 */

import { useEffect, useState } from 'react';

import { ago } from '../lib/format';
import { fileSize, moveStore, readStore, type StoreState } from '../lib/mb/store';
import { useStudio } from '../store/useStudio';
import { Button, Field, Icon, Input, Section, Strip } from '../ui';
import styles from './Settings.module.css';

export function StoreSection() {
  const toast = useStudio((s) => s.toast);
  const [state, setState] = useState<StoreState | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readStore().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* Not served by a host that keeps one — a static build, or a dev server. */
  if (state === null) return null;

  if (!state.kept) {
    return (
      <Section title="Where these mocks are kept" icon={<Icon name="file" />}>
        <p className={styles.note}>Nothing is written: {state.reason}.</p>
      </Section>
    );
  }

  async function save(): Promise<void> {
    setBusy(true);
    setProblem(null);
    const { state: next, error } = await moveStore(draft);
    setBusy(false);
    if (error !== null || next === null) {
      setProblem(error ?? 'That path could not be used.');
      return;
    }
    setState(next);
    setEditing(false);
    toast('Mocks are kept here from now on');
  }

  return (
    <Section
      title="Where these mocks are kept"
      icon={<Icon name="file" />}
      tools={
        editing ? undefined : (
          <Button
            size="sm"
            icon={<Icon name="cog" size={14} />}
            onClick={() => {
              setDraft(state.kept ? state.path : '');
              setProblem(null);
              setEditing(true);
            }}
          >
            Change
          </Button>
        )
      }
    >
      <p className={styles.note}>
        Every imposter, stub and response on this instance is one JSON file. The host reads it
        when it starts and rewrites it whenever anything changes, so closing the terminal loses
        nothing — and the file is something you can open, commit or hand to somebody.
      </p>

      {editing ? (
        <>
          <Field
            label="File"
            hint={`An absolute path, or one relative to ${state.cwd}. The mocks you have now are written there before it takes effect, and the choice is remembered for the next run.`}
          >
            <Input
              mono
              autoFocus
              value={draft}
              placeholder="./mocks.json"
              disabled={busy}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
              }}
            />
          </Field>
          {problem === null ? null : (
            <Strip tone="err" icon={<Icon name="alert" />} title="That path was refused">
              {problem}
            </Strip>
          )}
          <div className={styles.storeActs}>
            <Button onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Icon name="save" size={14} />}
              onClick={() => void save()}
              disabled={busy || draft.trim() === ''}
              aria-busy={busy}
            >
              {busy ? 'Moving…' : 'Keep Them Here'}
            </Button>
          </div>
        </>
      ) : (
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>File</dt>
            <dd className="mono">{state.path}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Size</dt>
            <dd>
              {state.exists ? fileSize(state.bytes) : 'not written yet — nothing has changed here'}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Last written</dt>
            <dd>{state.savedAt === null ? 'not this run' : ago(state.savedAt)}</dd>
          </div>
        </dl>
      )}

      {state.error === null ? null : (
        <Strip tone="err" icon={<Icon name="alert" />} title="The last save failed">
          {state.error} — what is on screen is running, but it is not on disk.
        </Strip>
      )}
    </Section>
  );
}

export default StoreSection;
