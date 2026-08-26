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

import { useId, useState, type ReactNode } from 'react';

import type { Imposter } from '../lib/mb/types';
import {
  Button,
  CodeEditor,
  Field,
  Icon,
  Input,
  Section,
  Select,
  Switch,
  Textarea,
} from '../ui';
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
  /**
   * The whole definition as JSON, rendered above the fields. Passed in rather than built
   * here: applying it replaces the imposter, which is the screen above's business, and
   * this file has no reason to know how that is done.
   */
  json?: ReactNode;
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
  json,
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
            : `Saving stops port ${imposter.port} and tries to start this imposter on ${port} — if ${port} is in use, the old one does not come back.`
          : 'These settings match the running imposter.';

  return (
    <>
      {/*
        What is about to happen reads first, and the buttons sit where a form's buttons
        belong: at the end of the row, confirming action last. They were on the left with
        the sentence trailing them, so the eye met "Save Changes" before the line saying
        that saving restarts the port.
      */}
      <div className={styles.bar}>
        <span className={!portOk || !nameOk ? styles.bad : styles.hint}>{status}</span>
        <div className={styles.spacer} />
        <Button variant="ghost" disabled={!dirty || saving} onClick={() => setDraft(seed(imposter))}>
          Revert
        </Button>
        <Button
          variant="primary"
          icon={<Icon name="save" />}
          disabled={locked || !dirty || !portOk || !nameOk}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
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

      {/* The whole definition, above the one field that is a slice of it. Editing JSON
          and editing these fields are two ways at the same object, so they belong on one
          screen rather than in tabs that hide each other. */}
      {json}

      <Section title="Default response">
        <Field
          hint={
            /* Not only when nothing matches: mountebank merges these fields into every
               response that leaves them out, so a status set here also changes responses
               that DID match a stub. And "200 with an empty body" is http/https only — a
               tcp imposter's default is `{ data: '' }`, and smtp ignores responses. */
            draft.protocol === 'tcp'
              ? 'Returned when no stub matches — and merged into any stub response that leaves a field out. Leave empty for Mountebank\u2019s own empty data.'
              : draft.protocol === 'smtp'
                ? 'An smtp imposter only does mock verification — Mountebank does not use responses for it, so this has no effect.'
                : 'Returned when no stub matches — and merged into any stub response that leaves a field out, so a status set here also applies to responses that do match. Leave empty for Mountebank\u2019s own 200 with an empty body.'
          }
        >
          <CodeEditor
            language="json"
            /* 132px held about four lines, which is shorter than the shortest useful
               response — a status and a one-line body already overflowed it. */
            height={260}
            value={draft.defaultResponse}
            readOnly={locked}
            onChange={locked ? undefined : (next) => patch({ defaultResponse: next })}
          />
        </Field>
      </Section>

      {draft.protocol === 'https' ? (
        <Section title="TLS">
          {/*
            PEM TEXT, NOT PATHS.
            
            These were labelled "Key file" and "Cert file", placeholders showed
            `./cert/server.key`, and the note said mountebank reads the path on its own
            host. None of that is true: the values go straight to `https.createServer`,
            which wants the certificate itself. A path produces
            ERR_OSSL_PEM_NO_START_LINE and the imposter never starts — and a single-line
            <input> could not have held a PEM anyway, since it would lose the newlines.
          */}
          <Field label="Private key (PEM)" htmlFor={`${id}-key`}>
            <Textarea
              id={`${id}-key`}
              className="mono"
              rows={4}
              placeholder={'-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----'}
              value={draft.key}
              disabled={locked}
              onChange={(e) => patch({ key: e.currentTarget.value })}
            />
          </Field>
          <Field label="Certificate (PEM)" htmlFor={`${id}-cert`}>
            <Textarea
              id={`${id}-cert`}
              className="mono"
              rows={4}
              placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'}
              value={draft.cert}
              disabled={locked}
              onChange={(e) => patch({ cert: e.currentTarget.value })}
            />
          </Field>
          <Switch
            /* Nothing is required: mountebank sets requestCert only when mutualAuth AND
               rejectUnauthorized are both on, this form never writes the second, and even
               with both it does not reject a bad client certificate. */
            label="Virtualize mutual auth (mutualAuth)"
            checked={draft.mutualAuth}
            disabled={locked}
            onChange={(next) => patch({ mutualAuth: next })}
          />
          <span className={styles.hint}>
            Paste the certificate itself, not a path — Mountebank hands these to Node&rsquo;s TLS
            server as they are. Left empty it uses its own self-signed pair. Mutual auth records
            the flag and asks for a client certificate; Mountebank never rejects a client over it,
            so this virtualizes the handshake rather than enforcing it.
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
