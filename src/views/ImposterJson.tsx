/**
 * The JSON tab: exactly what gets POSTed to `/imposters`, editable.
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
import { Button, CodeEditor, Icon } from '../ui';
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
export function ImposterJson({
  imposter,
  saving,
  onApply,
}: ImposterJsonProps) {
  const wire = useMemo(() => pretty(imposterToMb(imposter)), [imposter]);
  const [text, setText] = useState(wire);

  const parsed = useMemo(() => parse(text), [text]);
  const inSync = text === wire;
  const locked = saving;

  const readout = !parsed.ok
    ? { cls: styles.bad, icon: 'alert' as const, text: `invalid JSON — ${parsed.message}` }
    : inSync
      ? { cls: styles.ok, icon: 'check' as const, text: 'in sync' }
      : { cls: styles.ok, icon: 'check' as const, text: 'valid — apply to load it' };

  return (
    <>
      <div className={styles.head}>
        <span className="lbl">
          Exactly what gets POSTed to <span className="mono">/imposters</span>
        </span>
        <div className={styles.spacer} />
        <span className={`${styles.sync} ${readout.cls}`} aria-live="polite">
          <Icon name={readout.icon} />
          {readout.text}
        </span>
        {!inSync ? (
          <Button size="sm" variant="ghost" onClick={() => setText(wire)}>
            Reload from server
          </Button>
        ) : null}
        <Button
          size="sm"
          icon={<Icon name="check" />}
          disabled={locked || !parsed.ok || inSync}
          onClick={() => {
            if (parsed.ok) onApply(parsed.imposter);
          }}
        >
          {saving ? 'Replacing…' : 'Replace Imposter from JSON'}
        </Button>
      </div>

      <CodeEditor
        language="json"
        height={520}
        value={text}
        readOnly={locked}
        onChange={locked ? undefined : setText}
      />

      <p className={styles.note}>
        Applying deletes the imposter and creates it again from this text — mountebank has no
        partial update. Its captured requests do not survive.
      </p>
    </>
  );
}

export default ImposterJson;
