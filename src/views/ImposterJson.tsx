/**
 * The whole imposter as JSON — exactly what gets POSTed to `/imposters`, editable.
 *
 * It was a tab of its own until 0.2.0. It is a section on the imposter's Settings tab
 * now: reading the document and changing a field are the same job, and a tab that only
 * ever showed one text box was a place to get lost in.
 *
 * Two things this screen is careful about.
 *
 * The button names the real direction of the flow — "Replace imposter from
 * JSON" — because that is what happens: the text below replaces the imposter,
 * not the other way round. Nothing is sent while typing.
 *
 * The readout distinguishes three states, so "valid" never gets mistaken for
 * "applied": in sync with the server, valid but not applied yet, or unparseable.
 */

import { useMemo, useState } from 'react';

import { imposterFromMb, imposterToMb, pretty } from '../lib/mb/model';
import type { Imposter, MbImposter } from '../lib/mb/types';
import { Button, CodeEditor, Icon, Section } from '../ui';
import styles from './ImposterJson.module.css';

type Parsed = { ok: true; imposter: Imposter } | { ok: false; message: string };

/**
 * A parse is not enough — `{}` is valid JSON and not an imposter. A payload
 * mountebank would reject is refused here, where the message can be specific.
 */
function parse(text: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, message: 'an imposter must be a JSON object' };
  }

  const raw = value as Partial<MbImposter>;
  if (typeof raw.port !== 'number' || !Number.isInteger(raw.port)) {
    return { ok: false, message: 'no numeric "port"' };
  }
  if (typeof raw.protocol !== 'string' || raw.protocol === '') {
    return { ok: false, message: 'no "protocol"' };
  }

  return { ok: true, imposter: imposterFromMb(raw as MbImposter) };
}

export interface ImposterJsonProps {
  imposter: Imposter;
  /** false ⇒ the editor is read-only and nothing can be applied. */
  /** A write is in flight. */
  saving: boolean;
  /** Send this imposter — the parsed contents of the editor. */
  onApply: (next: Imposter) => void;
}

/**
 * Mounted with `key={imposter.port}` by the screen above, so the text is seeded
 * once per imposter and a background refetch cannot overwrite an edit in
 * progress. "Reload from server" is the deliberate way back.
 */
export function ImposterJson({ imposter, saving, onApply }: ImposterJsonProps) {
  const wire = useMemo(() => pretty(imposterToMb(imposter)), [imposter]);
  const [text, setText] = useState(wire);
  /**
   * READ-ONLY until somebody asks to replace the imposter.
   *
   * Three editors overlapped on one document: this one, the stub editor's JSON view, and
   * the Default response field. Same JSON at three zoom levels — but not the same write.
   * A stub goes through `PUT /imposters/:port/stubs/:index` and keeps everything the
   * imposter has captured; THIS one has no such endpoint to use, so it deletes the
   * imposter and creates it again, and the captured requests go with it.
   *
   * So the safe editor stays an editor and this one stops being one by default. It is the
   * place to read the whole document, copy it, or paste one in — and the last needs
   * saying out loud first, which is what the button now does.
   */
  const [replacing, setReplacing] = useState(false);

  const parsed = useMemo(() => parse(text), [text]);
  const inSync = text === wire;
  const locked = saving || !replacing;

  const readout = !parsed.ok
    ? { cls: styles.bad, icon: 'alert' as const, text: `invalid JSON — ${parsed.message}` }
    : !replacing
      ? {
          cls: styles.ok,
          icon: 'check' as const,
          text: 'exactly what this imposter is, as mountebank holds it',
        }
      : inSync
        ? { cls: styles.ok, icon: 'check' as const, text: 'editable — change it and apply' }
        : { cls: styles.ok, icon: 'check' as const, text: 'valid — apply to load it' };

  return (
    <Section
      title="Whole imposter as JSON"
      icon={<Icon name="code" />}
      tools={
        replacing ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setText(wire);
                setReplacing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Icon name="check" />}
              disabled={saving || !parsed.ok}
              onClick={() => {
                if (parsed.ok) onApply(parsed.imposter);
              }}
            >
              {saving ? 'Replacing…' : 'Yes, replace the imposter'}
            </Button>
          </>
        ) : (
          <Button size="sm" icon={<Icon name="up" />} onClick={() => setReplacing(true)}>
            Replace Imposter from JSON
          </Button>
        )
      }
    >
      {/*
        The readout is on a line of its own, not beside those buttons. A parser message
        carries the part that matters at its end — "line 49 column 28" — so it can be
        long, and in a wrapping row it pushed Replace down: the control moved because the
        text grew. Actions keep their place; the message gets room to be read whole.
      */}
      <p className={`${styles.sync} ${readout.cls}`} aria-live="polite">
        <Icon name={readout.icon} />
        {readout.text}
      </p>

      <CodeEditor
        language="json"
        height={520}
        value={text}
        readOnly={locked}
        onChange={locked ? undefined : setText}
      />

      <p className={styles.note}>
        {replacing ? (
          <>
            This is exactly what gets POSTed to <span className="mono">/imposters</span>.
            Applying deletes the imposter and creates it again from this text — mountebank has
            no PUT for a single imposter, so its captured requests do not survive.
          </>
        ) : (
          <>
            This is exactly what gets POSTed to <span className="mono">/imposters</span>, and it
            is shown rather than opened for editing: applying it deletes the imposter and
            creates it again, so the requests it has captured would go. To change one stub, open
            it from the list — that goes through the stub itself and keeps them.
          </>
        )}
      </p>
    </Section>
  );
}

export default ImposterJson;
