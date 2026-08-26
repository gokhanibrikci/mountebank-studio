/**
 * Bringing a file of imposters in.
 *
 * The mirror of the two ways out — Settings → Full configuration and the Postman download —
 * and it accepts the document the first of those shows, because a way out that cannot be
 * read back in is half a feature.
 *
 * NOTHING IS SENT UNTIL IT IS UNDERSTOOD. The file is parsed and checked as it is typed or
 * dropped, and the button says what will happen to which ports before it is pressed. A bulk
 * write is the one place where a surprise costs the most: this panel is often pointed at a
 * shared instance, and "half the file arrived" is a state nobody can reason about.
 *
 * TWO WAYS IN, AND THE DIFFERENCE IS SAID OUT LOUD.
 *
 *  • Add or replace by port — every imposter in the file is created; one whose port is
 *    already running is replaced. Anything running that the file does not mention is left
 *    alone. This is what a config file in a repository is for.
 *
 *  • Replace everything — the file becomes the whole environment, and imposters not in it
 *    are gone. One write, mountebank's own PUT /imposters.
 *
 * The second is destructive and says so, in the count of what it will remove rather than in
 * an adjective.
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import {
  countStubs,
  describeImposter,
  parseImposterJson,
  portsInUse,
  type ParsedImport,
} from '../lib/importConfig';
import { imposterFromMb } from '../lib/mb/model';
import type { Imposter, MbImposter } from '../lib/mb/types';
import { plural } from '../lib/format';
import { Button, CodeEditor, Icon, Modal, Pill } from '../ui';
import styles from './ImportModal.module.css';

export type ImportMode = 'merge' | 'replace';

export interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  /** What is running now — so the screen can name the ports this will take over. */
  existing: MbImposter[];
  /** A write is in flight somewhere above. */
  busy: boolean;
  /**
   * Called with the imposters as the editable model, since that is what every other write
   * on this screen takes. The caller decides how to send them: one at a time, or all at
   * once as the whole configuration.
   */
  onImport: (imposters: Imposter[], mode: ImportMode, removedPorts: number[]) => void;
}

const EMPTY: ParsedImport = { shape: null, imposters: [], problems: [] };

const SHAPE_NAME: Record<string, string> = {
  configfile: 'a mountebank configuration file',
  array: 'a list of imposters',
  single: 'one imposter',
};

export function ImportModal({ open, onClose, existing, busy, onImport }: ImportModalProps) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ImportMode>('merge');
  const [fileName, setFileName] = useState<string | null>(null);
  /**
   * Replacing everything asks twice.
   *
   * One press on a radio and one on a button was enough to empty an environment that other
   * people may be using, and the sentence explaining it sat above the button rather than in
   * it. The second press names what goes.
   */
  const [confirming, setConfirming] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  /* Every opening starts empty: a file left over from last time is a way to write the
     wrong thing to the wrong environment. */
  useEffect(() => {
    if (!open) return;
    setText('');
    setMode('merge');
    setFileName(null);
    setConfirming(false);
  }, [open]);

  const parsed = useMemo(() => (text.trim() === '' ? EMPTY : parseImposterJson(text)), [text]);
  const taken = useMemo(() => portsInUse(parsed.imposters, existing), [parsed.imposters, existing]);
  const removed = useMemo(() => {
    if (mode !== 'replace') return [];
    const arriving = new Set(parsed.imposters.map((i) => i.port));
    return existing.filter((i) => !arriving.has(i.port));
  }, [mode, parsed.imposters, existing]);

  const usable = parsed.imposters.length > 0;

  async function pick(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    if (file === undefined) return;
    setFileName(file.name);
    setText(await file.text());
    /* Cleared so choosing the same file twice fires again. */
    if (fileInput.current !== null) fileInput.current.value = '';
  }

  function submit(): void {
    if (!usable) return;
    /* Deleting somebody else's imposters is not a thing to do on one press. */
    if (mode === 'replace' && removed.length > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    onImport(parsed.imposters.map(imposterFromMb), mode, removed.map((i) => i.port));
  }

  /** What the button is about to do, in ports rather than adjectives. */
  const consequence = ((): string => {
    if (!usable) return '';
    const created = parsed.imposters.length - taken.length;
    const parts: string[] = [];
    if (created > 0) parts.push(`create ${plural(created, 'imposter')}`);
    if (taken.length > 0) parts.push(`replace ${plural(taken.length, 'port')} (${taken.join(', ')})`);
    if (removed.length > 0) {
      parts.push(`delete ${plural(removed.length, 'imposter')} not in the file (${removed.map((i) => i.port).join(', ')})`);
    }
    return parts.join(', ');
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import imposters"
      subtitle="The document Settings → Full configuration shows, read back in."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={mode === 'replace' ? 'danger' : 'primary'}
            icon={<Icon name="check" size={14} />}
            onClick={submit}
            disabled={!usable || busy}
            aria-busy={busy}
            title={usable ? consequence : 'Nothing usable has been pasted or chosen yet'}
          >
            {busy
              ? 'Writing…'
              : mode !== 'replace'
                ? `Import ${plural(parsed.imposters.length, 'imposter')}`
                : confirming
                  ? `Yes, delete ${plural(removed.length, 'imposter')} and replace`
                  : 'Replace Everything'}
          </Button>
        </>
      }
    >
      <div className={styles.pick}>
        <Button size="sm" icon={<Icon name="file" size={14} />} onClick={() => fileInput.current?.click()}>
          Choose a file
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className={styles.hidden}
          onChange={(event) => void pick(event)}
        />
        <span className={styles.picked}>
          {fileName ?? 'or paste below —'}{' '}
          {parsed.shape === null ? null : (
            <Pill tone="ok">{SHAPE_NAME[parsed.shape] ?? parsed.shape}</Pill>
          )}
        </span>
      </div>

      <CodeEditor language="json" height={300} value={text} onChange={setText} />

      {parsed.problems.length > 0 ? (
        <div className={styles.problems}>
          <p className={styles.problemHead}>
            <Icon name="alert" />
            {plural(parsed.problems.length, 'line')} in this file could not be used
            {usable ? ' — the rest still can be' : ''}
          </p>
          <ul>
            {parsed.problems.map((problem) => (
              <li key={`${problem.where}-${problem.what}`}>
                <b>{problem.where}</b> {problem.what}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {usable ? (
        <>
          <div className={styles.summary}>
            <p className={styles.summaryHead}>
              {plural(parsed.imposters.length, 'imposter')} · {plural(countStubs(parsed.imposters), 'stub')}
            </p>
            <ul>
              {parsed.imposters.map((imposter, index) => (
                <li key={`${imposter.port ?? 'auto'}-${index}`}>
                  <span className="mono">{describeImposter(imposter, index)}</span>{' '}
                  <span className={styles.dim}>
                    {imposter.protocol} · {plural(imposter.stubs?.length ?? 0, 'stub')}
                  </span>
                  {typeof imposter.port === 'number' && taken.includes(imposter.port) ? (
                    <Pill tone="warn">replaces what is on this port</Pill>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <fieldset className={styles.modes}>
            <legend className={styles.legend}>What to do with what is already here</legend>

            <label className={styles.mode}>
              <input
                type="radio"
                name="import-mode"
                checked={mode === 'merge'}
                onChange={() => {
                  setMode('merge');
                  setConfirming(false);
                }}
              />
              <span>
                <b>Add, replacing by port</b>
                <span className={styles.dim}>
                  Everything in the file is created. An imposter whose port is already running is
                  replaced. Anything running that the file does not mention is left alone.
                </span>
              </span>
            </label>

            <label className={styles.mode}>
              <input
                type="radio"
                name="import-mode"
                checked={mode === 'replace'}
                onChange={() => {
                  setMode('replace');
                  setConfirming(false);
                }}
              />
              <span>
                <b>Replace everything</b>
                <span className={styles.dim}>
                  The file becomes this environment. One write, and{' '}
                  {removed.length === 0
                    ? 'nothing else is running to lose'
                    : `${plural(removed.length, 'imposter')} not in the file — ${removed
                        .map((i) => i.port)
                        .join(', ')} — is deleted`}
                  .
                </span>
              </span>
            </label>
          </fieldset>

          <p className={confirming ? styles.confirming : styles.consequence}>
            <Icon name={confirming ? 'alert' : 'bolt'} />
            {confirming ? (
              <>
                <b>
                  {plural(removed.length, 'imposter')} will be deleted:{' '}
                  {removed.map((i) => i.name ?? `port ${i.port}`).join(', ')}
                </b>{' '}
                — press again to go ahead, or pick the other mode to keep them.
              </>
            ) : (
              <>
                This will {consequence}. Captured requests do not survive a replaced imposter —
                mountebank has no partial update.
              </>
            )}
          </p>
        </>
      ) : null}
    </Modal>
  );
}

export default ImportModal;
