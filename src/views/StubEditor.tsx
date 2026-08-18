/**
 * The stub editor drawer — two questions, one model, two surfaces.
 *
 * THREE DECISIONS SHAPE THIS FILE.
 *
 * 1. The drawer asks the two questions a mock is made of and nothing else:
 *    "When a request comes in" and "Then answer with". The matching side is held
 *    as a SimpleForm (lib/mb/simpleForm.ts), which projects Mountebank's
 *    predicates onto the shape of an HTTP request — method and path as named
 *    fields, query and headers as ordinary key/value lines. There is no
 *    Simple/Advanced switch: everything is always on screen. Rules the plain form
 *    cannot say ride along in `form.extras` and are written back verbatim, so
 *    opening a stub here can never quietly simplify it.
 *
 * 2. The draft is plain immutable state, because both panels are pure: they take
 *    a value and hand back a NEW one. Converting SimpleForm → Pred[] happens at
 *    exactly two moments — producing JSON, and saving — so the round-trip the
 *    simpleForm tests pin down is the only path the model ever takes.
 *
 * 3. Visual ⇄ JSON is one model with two surfaces. The JSON view is seeded from
 *    `stubToMb(stub)` and every keystroke tries to parse: on success the draft is
 *    replaced (keeping its id) and the pill says so; on failure the DRAFT IS LEFT
 *    ALONE and the pill carries the parser's real message. An unfinished edit can
 *    therefore never destroy the model — but it does block Save, so it cannot be
 *    silently discarded either.
 *
 * Saving is refused only for a reason the editor can name: an unparsable JSON
 * draft, or a stub that has gone from the imposter since it was opened.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { envOr } from '../store/useEnvironments';
import { mkStub, pretty, stubFromMb, stubToMb } from '../lib/mb/model';
import { fromSimpleForm, toSimpleForm } from '../lib/mb/simpleForm';
import type { SimpleForm } from '../lib/mb/simpleForm';
import type { MbStub, Resp, Stub } from '../lib/mb/types';
import { useConfig, useDeleteStub, useImposter, useSaveStub } from '../lib/queries';
import { sigOf, type StubSignature } from '../lib/summaries';
import { useStudio, type EditorView } from '../store/useStudio';
import { AnswerForm } from './AnswerForm';
import { Failure } from './Failure';
import { RequestMatch } from './RequestMatch';
import { Button, CodeEditor, Drawer, EmptyState, Icon, Pill, Section, Seg } from '../ui';
import styles from './StubEditor.module.css';

const VIEWS: { value: EditorView; label: string }[] = [
  { value: 'visual', label: 'Visual' },
  { value: 'json', label: 'JSON' },
];

/** The headline shown while there is no draft to read one from. */
const NO_SIG: StubSignature = { method: 'ANY', path: '*' };

/**
 * The editable stub, split the way the two panels want it.
 *
 * `id` survives every edit — including a wholesale JSON rewrite — so React keys
 * and the eventual save both keep pointing at the same stub.
 */
interface Draft {
  id: string;
  form: SimpleForm;
  responses: Resp[];
}

const draftOf = (stub: Stub): Draft => ({
  id: stub.id,
  form: toSimpleForm(stub.predicates),
  responses: stub.responses,
});

const stubOf = (draft: Draft): Stub => ({
  id: draft.id,
  predicates: fromSimpleForm(draft.form),
  responses: draft.responses,
});

export interface StubEditorProps {
  open: boolean;
  onClose: () => void;
  /** `null` opens a brand-new stub; a number edits the stub at that index. */
  index: number | null;
  /** Imposter port. Defaults to the `:port` route param. */
  port?: number;
  /** Starting point for a new stub, e.g. one built from a captured request. */
  seed?: Stub;
}

export function StubEditor({ open, onClose, index, port: portProp, seed }: StubEditorProps) {
  const params = useParams<{ port?: string }>();

  const env = useStudio((s) => s.env);
  const view = useStudio((s) => s.editorView);
  const setEditorView = useStudio((s) => s.setEditorView);

  const port = portProp ?? Number(params.port);
  const target = envOr(env);

  const detail = useImposter(env, port);
  const config = useConfig(env);
  // unknown until /config answers — assume allowed rather than crying wolf
  const allowInjection = config.data?.options.allowInjection !== false;

  const save = useSaveStub(env);
  const remove = useDeleteStub(env);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [json, setJson] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonTouched, setJsonTouched] = useState<boolean>(false);
  const seededRef = useRef<string | null>(null);

  /* ---- seeding, once per open ---- */
  const source = index === null ? undefined : detail.data?.imposter.stubs[index];
  const sessionKey = index === null ? `new@${port}` : `${port}#${index}`;

  useEffect(() => {
    if (!open) {
      // let a reopen re-seed, but keep the draft so the drawer does not blank
      // out while it slides away
      seededRef.current = null;
      return;
    }
    if (seededRef.current === sessionKey) return;

    const base = index === null ? (seed ?? mkStub()) : source;
    if (base === undefined) return; // still in flight

    seededRef.current = sessionKey;
    const clone = structuredClone(base);
    setDraft(draftOf(clone));
    setJson(pretty(stubToMb(clone)));
    setJsonError(null);
    setJsonTouched(false);
  }, [open, sessionKey, index, seed, source]);

  /*
   * The one place SimpleForm becomes predicates again. Everything downstream —
   * the subtitle, the JSON surface, the save — reads this stub, so the visual
   * and JSON views can never disagree about what would be written.
   */
  const stub = useMemo<Stub | null>(() => (draft === null ? null : stubOf(draft)), [draft]);
  const sig = stub === null ? NO_SIG : sigOf(stub);
  const imposterName = detail.data?.imposter.name ?? `port ${port}`;

  /* ---- view switching ---- */
  function changeView(next: EditorView): void {
    if (next === 'json' && stub !== null) {
      setJson(pretty(stubToMb(stub)));
      setJsonTouched(false);
    }
    // the model is by definition valid, so a stale parser message would lie
    setJsonError(null);
    setEditorView(next);
  }

  function editJson(next: string): void {
    setJson(next);
    setJsonTouched(true);

    if (draft === null) return;

    try {
      const parsed: unknown = JSON.parse(next);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('a stub must be a JSON object');
      }
      const rebuilt = stubFromMb(parsed as MbStub);
      setDraft({ ...draftOf(rebuilt), id: draft.id });
      setJsonError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setJsonError(`invalid JSON — ${message.replace(/^JSON\.parse: /, '')}`);
    }
  }

  /* ---- writes. Both hooks toast their own outcome. ---- */
  function onSave(): void {
    if (stub === null) return;
    save.mutate(
      { port, index, stub, imposterName: detail.data?.imposter.name },
      { onSuccess: () => onClose() },
    );
  }

  function onDelete(): void {
    if (index === null) return;
    remove.mutate({ port, index }, { onSuccess: () => onClose() });
  }

  /* ---- header: the in-sync / invalid pill ---- */
  const syncPill =
    jsonError === null ? (
      <span className={`${styles.sync} ${styles.syncOk}`}>
        <Icon name="check" />
        {jsonTouched ? 'visual editor updated' : 'in sync'}
      </span>
    ) : (
      <span className={`${styles.sync} ${styles.syncBad}`} title={jsonError}>
        <Icon name="alert" />
        {jsonError}
      </span>
    );

  const saveBlocked = stub === null || jsonError !== null || save.isPending;

  /* ---- body ---- */
  function renderBody() {
    if (draft === null) {
      if (detail.isError) {
        return (
          <EmptyState
            wide
            title="Could not load this imposter"
            action={
              <Button icon={<Icon name="reqs" />} onClick={() => void detail.refetch()}>
                Try Again
              </Button>
            }
          >
            <Failure target={target.target} error={detail.error} />
          </EmptyState>
        );
      }
      if (index !== null && detail.isSuccess && source === undefined) {
        return (
          <EmptyState title="That stub is gone" action={<Button onClick={onClose}>Close</Button>}>
            Stub #{index + 1} is no longer on {imposterName} — someone else changed this imposter
            while the drawer was opening.
          </EmptyState>
        );
      }
      return (
        <EmptyState title="Loading this stub…">
          Reading {imposterName} from {target.label}.
        </EmptyState>
      );
    }

    if (view === 'json') {
      return (
        <>
          <p className={styles.lead}>
            Edit freely — the visual editor picks up your changes as soon as the JSON parses, and a
            half-finished edit is never applied.
          </p>
          <CodeEditor language="json" value={json} height={560} onChange={editJson} />
        </>
      );
    }

    return (
      <>
        <Section
          icon={<Icon name="reqs" />}
          title="When a request comes in"
          tools={<span className="lbl">Every line has to match</span>}
        >
          <RequestMatch form={draft.form} onChange={(form) => setDraft({ ...draft, form })} />
        </Section>

        <Section
          icon={<Icon name="file" />}
          title="Then answer with"
          tools={
            draft.responses.length > 1 ? (
              <Pill tone="acc">cycles through {draft.responses.length}</Pill>
            ) : undefined
          }
        >
          <AnswerForm
            responses={draft.responses}
            injectionAllowed={allowInjection}
            onChange={(responses) => setDraft({ ...draft, responses })}
          />
        </Section>
      </>
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={index === null ? 'New Stub' : 'Edit Stub'}
      subtitle={`${sig.method} ${sig.path} · ${imposterName}`}
      tools={
        <>
          {syncPill}
          <Seg value={view} options={VIEWS} onChange={changeView} label="Editor view" />
        </>
      }
      footer={
        <>
          {index === null ? null : (
            <Button
              variant="danger"
              icon={<Icon name="trash" />}
              disabled={remove.isPending}
              onClick={onDelete}
            >
              {remove.isPending ? 'Deleting…' : 'Delete Stub'}
            </Button>
          )}
          <div className={styles.spacer} />
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={<Icon name="check" />}
            disabled={saveBlocked}
            title={jsonError === null ? undefined : `Fix the JSON first — ${jsonError}`}
            onClick={onSave}
          >
            {save.isPending ? 'Saving…' : 'Save Stub'}
          </Button>
        </>
      }
    >
      {renderBody()}
    </Drawer>
  );
}
