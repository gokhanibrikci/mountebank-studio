/**
 * New imposter — the create flow, ported from the prototype's
 * `newImposterModal()` + `createImposter()`.
 *
 * Two things it exists to get right:
 *
 *  1. THE PORT IS THE IDENTITY. Mountebank has no concept of an imposter name
 *     as a key, so a port that is already in use is not a conflict to resolve
 *     later — it is a request that cannot succeed. The modal refuses it up
 *     front and names the imposter holding it, rather than sending a POST that
 *     comes back "port in use" with no idea which mock owns it.
 *
 *  2. THE TEMPLATES ARE ORDINARY STUBS. "Start with" writes real stubs into the
 *     new imposter — nothing hidden, nothing special-cased — so the first thing
 *     the user sees in the editor is something they can read, edit and delete
 *     like anything else they will make later.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { type EnvId } from '../lib/environments';
import { mkCondition, mkImposter, mkPred, mkResp, mkStub, pretty } from '../lib/mb/model';
import type { Imposter, Stub } from '../lib/mb/types';
import { useCreateImposter } from '../lib/queries';
import { Button, Field, Icon, Input, Modal, Off, Select, Switch } from '../ui';
import styles from './NewImposterModal.module.css';

/**
 * The highest port there is. A number above it is refused here rather than sent
 * for mountebank to reject.
 */
const LAST_PORT = 65_535;

/* ────────────────────────────────  templates  ──────────────────────────── */

export type Template = 'empty' | 'token' | 'proxy';

const PROTOCOLS = ['http', 'https', 'tcp', 'smtp'] as const;

/**
 * The OAuth token stub.
 *
 * ONE predicate carrying TWO conditions — `{equals:{method,path}}` — which is
 * both the idiomatic mountebank form and the form the dev environment already
 * uses. Splitting it into two predicates would read differently the moment
 * anyone wraps it in an `or`.
 */
const tokenStub = (): Stub =>
  mkStub({
    predicates: [
      mkPred({
        conditions: [
          mkCondition({ field: 'method', value: 'POST' }),
          mkCondition({ field: 'path', value: '/v1/auth/oauth/token' }),
        ],
      }),
    ],
    responses: [
      mkResp('is', {
        is: {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: pretty({
            access_token: 'mock-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          extras: {},
        },
      }),
    ],
  });

/** A catch-all proxy: no predicates, so it answers everything it is asked. */
const proxyStub = (): Stub =>
  mkStub({
    predicates: [],
    responses: [
      mkResp('proxy', {
        proxy: {
          to: 'https://',
          mode: 'proxyOnce',
          genMethod: true,
          genPath: true,
          genQuery: false,
          genBody: false,
          addWait: false,
          decorate: '',
          generators: [],
          extras: {},
        },
      }),
    ],
  });

const stubsFor = (template: Template): Stub[] => {
  if (template === 'token') return [tokenStub()];
  if (template === 'proxy') return [proxyStub()];
  return [];
};

/* ────────────────────────────────  the modal  ──────────────────────────── */

export interface NewImposterModalProps {
  open: boolean;
  onClose: () => void;
  env: EnvId;
  /**
   * Every imposter already in this environment. Port collisions are refused
   * against this list, so it must be the live one, not a snapshot.
   */
  imposters: Imposter[];
  /**
   * The port to prefill — the lowest free one in this environment. Computed by
   * the list screen, which needs the same rule for "Duplicate", so the rule
   * lives in exactly one place.
   */
  suggestedPort: number;
}

interface PortCheck {
  port: number;
  /** null when the port is usable as far as this panel can tell. */
  error: string | null;
}

function checkPort(text: string, imposters: Imposter[]): PortCheck {
  const port = Number(text);

  if (text.trim() === '') {
    return { port: NaN, error: 'Enter a port number.' };
  }
  if (!Number.isInteger(port)) {
    return { port: NaN, error: 'A port is a whole number.' };
  }
  if (port < 1 || port > LAST_PORT) {
    return { port, error: `A port must be between 1 and ${LAST_PORT}.` };
  }

  const holder = imposters.find((i) => i.port === port);
  if (holder) {
    return { port, error: `Port ${port} is already taken by ${holder.name}.` };
  }

  /*
   * The port this page is served on. An imposter there answers instead of the panel
   * — and on a machine that resolves localhost to IPv6 first it can bind alongside
   * it, so the panel appears to break for no reason. Refused rather than explained
   * afterwards.
   */
  if (String(port) === window.location.port) {
    return {
      port,
      error: `Port ${port} is where this panel is served. An imposter there would answer instead of it.`,
    };
  }

  return { port, error: null };
}

export function NewImposterModal({
  open,
  onClose,
  env,
  imposters,
  suggestedPort,
}: NewImposterModalProps) {
  const navigate = useNavigate();
  const create = useCreateImposter(env);

  const ids = useId();
  const nameId = `${ids}-name`;
  const portId = `${ids}-port`;
  const protoId = `${ids}-proto`;
  const tplId = `${ids}-tpl`;
  const portErrId = `${ids}-port-err`;

  const [name, setName] = useState('');
  const [port, setPort] = useState('');
  const [protocol, setProtocol] = useState<string>('http');
  const [template, setTemplate] = useState<Template>('token');
  const [record, setRecord] = useState(true);

  /**
   * Every opening starts clean, with the port suggested from the live list.
   *
   * `suggestedPort` is read here but is NOT a dependency: it changes whenever
   * the list refetches, and moving the port out from under the user's cursor
   * mid-form would be hostile.
   */
  const suggestionRef = useRef(suggestedPort);

  useEffect(() => {
    suggestionRef.current = suggestedPort;
  }, [suggestedPort]);

  useEffect(() => {
    if (!open) return;
    setName('');
    setPort(String(suggestionRef.current));
    setProtocol('http');
    setTemplate('token');
    setRecord(true);
  }, [open]);

  const { port: portNumber, error: portError } = checkPort(port, imposters);
  const canCreate = portError === null && !create.isPending;

  function submit(): void {
    if (!canCreate) return;

    const imposter = mkImposter({
      port: portNumber,
      // an unnamed imposter is named after its port, so the list never shows a blank
      name: name.trim() || `imposter-${portNumber}`,
      protocol,
      recordRequests: record,
      stubs: stubsFor(template),
    });

    create.mutate(imposter, {
      onSuccess: () => {
        onClose();
        navigate(`/${env}/imposters/${imposter.port}`);
      },
    });
  }

  // Enter anywhere in the form creates, as it would in a native form
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New imposter"
      subtitle="One mock server, one port."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={<Icon name="check" size={14} />}
            onClick={submit}
            disabled={!canCreate}
            aria-busy={create.isPending}
          >
            Create Imposter
          </Button>
        </>
      }
    >
      <div className={styles.form} onKeyDown={onKeyDown}>
        <Field label="Name" htmlFor={nameId}>
          <Input
            id={nameId}
            placeholder="orders-api"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </Field>

        <div className={styles.grid2}>
          <Field
            label="Port"
            htmlFor={portId}
            hint={
              portError !== null ? (
                <span id={portErrId}>
                  <Off>{portError}</Off>
                </span>
              ) : undefined
            }
          >
            <Input
              id={portId}
              className="num"
              mono
              type="number"
              inputMode="numeric"
              min={1}
              max={LAST_PORT}
              value={port}
              aria-invalid={portError !== null}
              aria-describedby={portError !== null ? portErrId : undefined}
              onChange={(e) => setPort(e.currentTarget.value)}
            />
          </Field>

          <Field label="Protocol" htmlFor={protoId}>
            <Select
              id={protoId}
              value={protocol}
              onChange={(e) => setProtocol(e.currentTarget.value)}
            >
              {PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Start with"
          htmlFor={tplId}
          hint="Templates are ordinary stubs — edit or delete them like any other."
        >
          <Select
            id={tplId}
            value={template}
            onChange={(e) => setTemplate(e.currentTarget.value as Template)}
          >
            <option value="empty">Nothing — I&rsquo;ll add stubs myself</option>
            <option value="token">An OAuth token stub (POST /v1/auth/oauth/token)</option>
            <option value="proxy">A catch-all proxy to a real service</option>
          </Select>
        </Field>

        <Switch
          checked={record}
          onChange={setRecord}
          label="Record requests"
          title="Store incoming requests for inspection"
        />
      </div>
    </Modal>
  );
}
