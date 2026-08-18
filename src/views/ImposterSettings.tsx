/**
 * The Settings tab of an imposter.
 *
 * Mountebank has no PUT for a single imposter — an edit is delete-then-create
 * (see client.ts). That is why this form is a DRAFT with an explicit save rather
 * than live-bound fields: every keystroke would otherwise restart the imposter
 * and throw its captured requests away. The draft holds only the settings; the
 * stubs always travel from the freshest server copy, so saving settings can
 * never revert somebody's stub edit.
 */

import { useId, useState } from 'react';

import type { Imposter } from '../lib/mb/types';
import { Button, CodeEditor, Field, Icon, Input, Section, Select, Switch } from '../ui';
import styles from './ImposterSettings.module.css';

const PROTOCOLS = ['http', 'https', 'tcp', 'smtp'];

/** Only the fields this form owns. Stubs and counters are not settings. */
interface Draft {
  name: string;
  /** Held as text so a half-typed port is not read as 4 or NaN. */
  portText: string;
  protocol: string;
  recordRequests: boolean;
  defaultResponse: string;
  key: string;
  cert: string;
  mutualAuth: boolean;
}

const seed = (imposter: Imposter): Draft => ({
  name: imposter.name,
  portText: String(imposter.port),
  protocol: imposter.protocol,
  recordRequests: imposter.recordRequests,
  defaultResponse: imposter.defaultResponse,
  key: imposter.key,
  cert: imposter.cert,
  mutualAuth: imposter.mutualAuth,
});

export interface ImposterSettingsProps {
  imposter: Imposter;
  /** A write is in flight. */
  saving: boolean;
  /** Receives the full imposter — stubs included — ready to send. */
  onSave: (next: Imposter) => void;
  /** Opens the delete confirmation, which the screen above owns. */
  onDelete: () => void;
}

/**
 * Mounted with `key={imposter.port}` by the screen above, so the draft is seeded
 * once per imposter and a background refetch never overwrites what is being
 * typed.
 */
export function ImposterSettings({
  imposter,
  saving,
  onSave,
  onDelete,
}: ImposterSettingsProps) {
  const id = useId();

  const [draft, setDraft] = useState<Draft>(() => seed(imposter));
  const patch = (part: Partial<Draft>) => setDraft((d) => ({ ...d, ...part }));

  const port = Number(draft.portText);
  const portOk = Number.isInteger(port) && port > 0 && port < 65_536;
  const nameOk = draft.name.trim() !== '';

  const dirty =
    draft.name !== imposter.name ||
    draft.portText !== String(imposter.port) ||
    draft.protocol !== imposter.protocol ||
    draft.recordRequests !== imposter.recordRequests ||
    draft.defaultResponse !== imposter.defaultResponse ||
    draft.key !== imposter.key ||
    draft.cert !== imposter.cert ||
    draft.mutualAuth !== imposter.mutualAuth;

  const locked = saving;

  function save() {
    if (!portOk || !nameOk) return;
    onSave({
      ...imposter,
      name: draft.name.trim(),
      port,
      protocol: draft.protocol,
      recordRequests: draft.recordRequests,
      defaultResponse: draft.defaultResponse,
      key: draft.key,
      cert: draft.cert,
      mutualAuth: draft.mutualAuth,
    });
  }

  const status = !portOk
      ? 'A port must be a whole number between 1 and 65535.'
      : !nameOk
        ? 'An imposter needs a name.'
        : dirty
          ? port === imposter.port
            ? `Saving restarts port ${imposter.port} with these settings — its captured requests do not survive.`
            : `Saving stops port ${imposter.port} and starts this imposter on ${port} instead.`
          : 'These settings match the running imposter.';

  return (
    <>
      <div className={styles.bar}>
        <Button
          variant="primary"
          icon={<Icon name="save" />}
          disabled={locked || !dirty || !portOk || !nameOk}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
        <Button
          variant="ghost"
          disabled={!dirty || saving}
          onClick={() => setDraft(seed(imposter))}
        >
          Revert
        </Button>
        <div className={styles.spacer} />
        <span className={!portOk || !nameOk ? styles.bad : styles.hint}>{status}</span>
      </div>

      <Section title="Basics">
        <div className={styles.grid3}>
          <Field label="Name" htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              value={draft.name}
              disabled={locked}
              onChange={(e) => patch({ name: e.currentTarget.value })}
            />
          </Field>
          <Field label="Port" htmlFor={`${id}-port`}>
            <Input
              id={`${id}-port`}
              className="num"
              mono
              inputMode="numeric"
              value={draft.portText}
              disabled={locked}
              onChange={(e) => patch({ portText: e.currentTarget.value })}
            />
          </Field>
          <Field label="Protocol" htmlFor={`${id}-proto`}>
            <Select
              id={`${id}-proto`}
              value={draft.protocol}
              disabled={locked}
              onChange={(e) => patch({ protocol: e.currentTarget.value })}
            >
              {PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Switch
          label="Record requests"
          title="Store incoming requests for inspection"
          checked={draft.recordRequests}
          disabled={locked}
          onChange={(next) => patch({ recordRequests: next })}
        />
      </Section>

      <Section title="Default response">
        <Field hint="Returned when no stub matches. Leave empty for Mountebank's own 200 with an empty body.">
          <CodeEditor
            language="json"
            height={132}
            value={draft.defaultResponse}
            readOnly={locked}
            onChange={locked ? undefined : (next) => patch({ defaultResponse: next })}
          />
        </Field>
      </Section>

      {draft.protocol === 'https' ? (
        <Section title="TLS">
          <div className={styles.grid2}>
            <Field label="Key file" htmlFor={`${id}-key`}>
              <Input
                id={`${id}-key`}
                mono
                placeholder="./cert/server.key"
                value={draft.key}
                disabled={locked}
                onChange={(e) => patch({ key: e.currentTarget.value })}
              />
            </Field>
            <Field label="Cert file" htmlFor={`${id}-cert`}>
              <Input
                id={`${id}-cert`}
                mono
                placeholder="./cert/server.crt"
                value={draft.cert}
                disabled={locked}
                onChange={(e) => patch({ cert: e.currentTarget.value })}
              />
            </Field>
          </div>
          <Switch
            label="Require a client certificate (mutualAuth)"
            checked={draft.mutualAuth}
            disabled={locked}
            onChange={(next) => patch({ mutualAuth: next })}
          />
          <span className={styles.hint}>
            Paths are read by Mountebank on the host it runs on, not uploaded from here.
          </span>
        </Section>
      ) : null}

      <Section title="Danger zone">
        <div className={styles.row}>
          <span className={styles.note}>
            Deleting an imposter frees its port and discards its stubs and captured requests.
          </span>
          <div className={styles.spacer} />
          <Button
            variant="danger"
            icon={<Icon name="trash" />}
            disabled={locked}
              onClick={onDelete}
          >
            Delete Imposter
          </Button>
        </div>
      </Section>
    </>
  );
}

export default ImposterSettings;
