/**
 * The "then answer" side of a stub — written as plainly as the match side.
 *
 * THREE DECISIONS SHAPE THIS FILE.
 *
 * 1. ONE ANSWER HAS NO CHROME. A stub almost always answers one way, and that
 *    case must read as a plain stack of fields: no card, no border, no "#1", no
 *    nesting. Numbering, reordering and the sentence about the cycle appear only
 *    once a second answer exists — because only then is there an order to explain.
 *
 * 2. THE WORDS ARE THE USER'S, NOT MOUNTEBANK'S. "Static reply", "Forward to a
 *    real service", "Run JavaScript"; each forwarding mode spells out what it
 *    does rather than naming `proxyOnce`. Behaviors stop being a typed list and
 *    become settings: a delay is a "Wait before answering" row, and the four rare
 *    ones are added from an "Add Step" menu.
 *
 * 3. THE INCOMING ARRAY IS NEVER MUTATED. Every edit reports a NEW array through
 *    `onChange`, so the parent owns the model — and must render back what it was
 *    given, either from state or by repainting after it stores it, since adding,
 *    removing, reordering and switching kind are all reported the same way.
 *
 *    Text controls still hold their own local copy of what they show (see
 *    `useMirror`) for two reasons: the caret survives the parent's re-render, and
 *    typing a status code repaints its own pill and nothing else — no keystroke
 *    needs the panel to re-render to be seen. A value replaced from OUTSIDE — the
 *    JSON view rewriting the stub — is still picked up, because the mirror
 *    notices the incoming value moved on its own.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';

import { plural, STATUS_TEXT, statusTone, type StatusTone } from '../lib/format';
import { pretty, uid } from '../lib/mb/model';
import type {
  Behavior,
  MbBehaviorName,
  MbProxyMode,
  ProxyResponse,
  Resp,
  RespType,
  MbFault,
} from '../lib/mb/types';
import { useStudio } from '../store/useStudio';
import { Button, CodeEditor, Field, Icon, Input, Pill, Seg, Select, Strip, Switch } from '../ui';
import type { IconName, PillTone, SegOption } from '../ui';
import styles from './AnswerForm.module.css';

/* ──────────────────────────────  vocabulary  ───────────────────────────── */

const KINDS: { value: RespType; label: string; icon: IconName }[] = [
  { value: 'is', label: 'Static reply', icon: 'file' },
  { value: 'proxy', label: 'Forward to a real service', icon: 'globe' },
  { value: 'inject', label: 'Run JavaScript', icon: 'bolt' },
  { value: 'fault', label: 'Break the connection', icon: 'alert' },
];

/**
 * A fault answers nothing at all — it is how you make the caller face a network
 * failure rather than an error status. Mountebank offers exactly these two.
 */
const FAULTS: { value: MbFault; label: string; hint: string }[] = [
  {
    value: 'CONNECTION_RESET_BY_PEER',
    label: 'Reset the connection',
    /* Not a reset: mountebank calls socket.destroy() after the request has been read, so
       the caller gets a clean close with nothing in it. Naming an errno it does not
       receive sends people looking for the wrong thing in their logs. */
    hint: 'The socket is closed with no reply at all — the caller sees an empty response and a dropped connection.',
  },
  {
    value: 'RANDOM_DATA_THEN_CLOSE',
    label: 'Send garbage, then close',
    /* "Random" is the fault's NAME, not its behaviour: mountebank writes one hardcoded
       32-byte string, the same on every request. */
    hint: 'A short fixed run of garbage bytes goes back before the socket closes, so the caller has to fail parsing.',
  },
];

/** Each mode explains itself — the wire name is never shown. */
const FORWARD_MODES: { value: MbProxyMode; label: string }[] = [
  { value: 'proxyOnce', label: 'Record the first reply, then replay it' },
  { value: 'proxyAlways', label: 'Forward every time and keep recording' },
  { value: 'proxyTransparent', label: 'Pass through and record nothing' },
];

/**
 * Which parts of the recorded request become conditions on the stub Mountebank
 * saves. Each part carries its own setter so no computed key is ever spread into
 * `ProxyResponse` — the flags stay individually typed.
 */
const RECORDED_PARTS: {
  key: 'genMethod' | 'genPath' | 'genQuery' | 'genBody';
  label: string;
  /** Reading the flag, so the hint can say what nothing-ticked actually does. */
  on: (proxy: ProxyResponse) => boolean;
  set: (proxy: ProxyResponse, on: boolean) => ProxyResponse;
}[] = [
  { key: 'genMethod', label: 'Method', on: (p) => p.genMethod === true, set: (p, on) => ({ ...p, genMethod: on }) },
  { key: 'genPath', label: 'Path', on: (p) => p.genPath === true, set: (p, on) => ({ ...p, genPath: on }) },
  { key: 'genQuery', label: 'Query', on: (p) => p.genQuery === true, set: (p, on) => ({ ...p, genQuery: on }) },
  { key: 'genBody', label: 'Body', on: (p) => p.genBody === true, set: (p, on) => ({ ...p, genBody: on }) },
];

/**
 * What each forwarding mode actually does with a recorded reply.
 *
 * Measured against 2.9.4: proxyOnce saves the recording ahead of the proxy stub, so the
 * next matching call is answered from it; proxyAlways saves it behind, so the proxy keeps
 * winning the match and nothing is ever replayed; proxyTransparent records nothing.
 */
const PROXY_MODE_HINT: Record<MbProxyMode, string> = {
  proxyOnce:
    'The first reply is recorded as a new answer that takes over from then on — the real service is called once.',
  proxyAlways:
    'Every request keeps going to the real service. The replies are recorded behind this answer, so they pile up but are never replayed.',
  proxyTransparent: 'Nothing is recorded — every request goes straight through, every time.',
};

interface StepSpec {
  /** Sentence case — it names the step in the row. */
  label: string;
  /** Title Case — it is a button in the Add Step menu. */
  action: string;
  placeholder: string;
  hint: string;
}

const STEP_SPEC: Record<MbBehaviorName, StepSpec> = {
  wait: {
    label: 'Wait',
    action: 'Wait',
    placeholder: '500',
    hint: 'Milliseconds to hold the answer back.',
  },
  decorate: {
    label: 'Decorate',
    action: 'Decorate',
    placeholder: '(request, response) => { response.body += "!" }',
    hint: 'Run JavaScript over the finished answer. Needs injection switched on.',
  },
  /*
   * `copy` and `lookup` are OBJECTS to mountebank — `{from, into, using}` and
   * `{key, fromDataSource, into}` — and this panel writes whatever is typed as a bare
   * string. So the arrow syntax and the file path these placeholders used to show were
   * not shorthand for anything: following either one made the stub unsavable. They now
   * show the shape mountebank actually takes, and say where to edit it.
   */
  copy: {
    label: 'Copy from the request',
    action: 'Copy From Request',
    placeholder: '{"from":"body","into":"${APPID}","using":{"method":"jsonpath","selector":"$..applicationId"}}',
    hint: 'Lift a value out of the request and paste it into the answer. Mountebank takes an object here — from, into and using — so it is written in the JSON view.',
  },
  lookup: {
    label: 'Look up in a file',
    action: 'Look Up In A File',
    placeholder: '{"key":{"from":"path","using":{"method":"regex","selector":"[^/]+$"}},"fromDataSource":{"csv":{"path":"/data/cards.csv","keyColumn":"pan"}},"into":"${row}"}',
    hint: 'Fill the answer from a row of an external data file. Mountebank takes an object here — key, fromDataSource and into — so it is written in the JSON view.',
  },
  shellTransform: {
    label: 'Shell command',
    action: 'Shell Command',
    placeholder: './transform.sh',
    /* Mountebank refuses to save a shellTransform without --allowInjection, exactly as it
       refuses inject and decorate — and only those two said so. */
    hint: 'Pipe the answer through a shell command. Needs injection switched on.',
  },
};

/** The delay has a row of its own, so the menu offers the other four. */
const ADDABLE_STEPS: MbBehaviorName[] = ['decorate', 'copy', 'lookup', 'shellTransform'];

const STATUS_PILL: Record<StatusTone, PillTone> = {
  ok: 'ok',
  warn: 'warn',
  err: 'err',
  '': 'neutral',
};

/* ────────────────────────────  local text state  ───────────────────────── */

/**
 * Text that a control shows and owns.
 *
 * The value is reported upward on every keystroke, but what is DRAWN comes from
 * here — so the control never waits for a re-render to show a character, and the
 * caret cannot be dragged back to the end by one. When the incoming value moves
 * on its own (the JSON view replacing the stub) the mirror adopts it.
 *
 * The comparison value is STATE, not a ref: React's documented way of adjusting
 * state to a changed prop. A ref written during render would survive a discarded
 * render pass, and the mirror would then believe it had already adopted a value
 * it never showed.
 */
function useMirror(external: string): [string, (next: string) => void] {
  const [text, setText] = useState<string>(external);
  const [seen, setSeen] = useState<string>(external);

  if (external !== seen) {
    setSeen(external);
    setText(external);
  }

  return [text, setText];
}

/** What one step's value looks like as text. */
function stepText(value: Behavior['value']): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  // `copy` and `lookup` arrive from the wire as objects; show them honestly
  return pretty(value as unknown);
}

/** True when a step's value is plain text a single input can edit safely. */
const isTextStep = (value: Behavior['value']): boolean =>
  typeof value === 'string' || typeof value === 'number';

/* ─────────────────────────────  static reply  ──────────────────────────── */

interface PartProps {
  resp: Resp;
  disabled: boolean;
  onPatch: (part: Partial<Resp>) => void;
}

/**
 * The status code and the name it stands for. The name is patched straight from
 * the local text, so typing `50` on the way to `503` repaints this pill alone.
 */
function StatusField({ resp, disabled, onPatch }: PartProps): ReactElement {
  const [code, setCode] = useMirror(String(resp.is.statusCode));

  const numeric = Number(code);
  const valid = code.trim() !== '' && Number.isFinite(numeric);

  return (
    <Field label="Status code">
      <div className={styles.statusRow}>
        <Input
          mono
          type="number"
          className={`num ${styles.short}`}
          value={code}
          disabled={disabled}
          aria-label="Status code"
          onChange={(e) => {
            const next = e.currentTarget.value;
            setCode(next);
            onPatch({ is: { ...resp.is, statusCode: next } });
          }}
        />
        <Pill tone={valid ? STATUS_PILL[statusTone(numeric)] : 'neutral'}>
          {valid ? (STATUS_TEXT[numeric] ?? 'Custom') : 'No code'}
        </Pill>
      </div>
    </Field>
  );
}

interface HeaderLine {
  id: string;
  key: string;
  value: string;
}

/**
 * Headers are a `Record` on the wire but an ORDERED LIST while being edited:
 * renaming a key in place would reshuffle the object and lose the caret. The
 * record is rebuilt from the list after every change, and only then — an
 * untouched response keeps its headers exactly as they arrived.
 */
function HeaderLines({ resp, disabled, onPatch }: PartProps): ReactElement {
  const [lines, setLines] = useState<HeaderLine[]>(() =>
    Object.entries(resp.is.headers).map(([key, value]) => ({ id: uid('h'), key, value })),
  );

  function commit(next: HeaderLine[]): void {
    setLines(next);
    const bag: Record<string, string> = {};
    for (const line of next) if (line.key.trim() !== '') bag[line.key] = line.value;
    onPatch({ is: { ...resp.is, headers: bag } });
  }

  return (
    <Field
      label="Headers"
      hint="Sent back with the reply as written — names, casing and values are untouched. Mountebank still recalculates Content-Length if you set it."
    >
      {lines.map((line, index) => (
        <div className={styles.kvLine} key={line.id}>
          <Input
            mono
            value={line.key}
            disabled={disabled}
            aria-label="Header name"
            placeholder="Content-Type"
            onChange={(e) =>
              commit(lines.map((l, i) => (i === index ? { ...l, key: e.currentTarget.value } : l)))
            }
          />
          <Input
            mono
            value={line.value}
            disabled={disabled}
            aria-label="Header value"
            placeholder="application/json"
            onChange={(e) =>
              commit(
                lines.map((l, i) => (i === index ? { ...l, value: e.currentTarget.value } : l)),
              )
            }
          />
          <Button
            variant="ghost"
            iconOnly
            icon={<Icon name="x" />}
            disabled={disabled}
            onClick={() => commit(lines.filter((_, i) => i !== index))}
            title="Remove this header"
            aria-label="Remove this header"
          />
        </div>
      ))}
      <Button
        size="sm"
        className={styles.selfStart}
        icon={<Icon name="plus" />}
        disabled={disabled}
        onClick={() => commit([...lines, { id: uid('h'), key: '', value: '' }])}
      >
        Add Header
      </Button>
    </Field>
  );
}

function BodyField({ resp, disabled, onPatch }: PartProps): ReactElement {
  const [text, setText] = useMirror(resp.is.body);
  const toast = useStudio((s) => s.toast);

  function format(): void {
    try {
      const formatted = pretty(JSON.parse(text) as unknown);
      setText(formatted);
      onPatch({ is: { ...resp.is, body: formatted } });
      toast('Formatted');
    } catch (error) {
      toast(`Not valid JSON yet: ${(error as Error).message}`, 'warn');
    }
  }

  return (
    <Field label="Body">
      <CodeEditor
        language="json"
        value={text}
        height={190}
        readOnly={disabled}
        onChange={
          disabled
            ? undefined
            : (next) => {
                setText(next);
                onPatch({ is: { ...resp.is, body: next } });
              }
        }
        toolbar={
          <Button size="sm" disabled={disabled} onClick={format}>
            Format JSON
          </Button>
        }
      />
    </Field>
  );
}

/* ───────────────────────────────  forwarding  ──────────────────────────── */

function ForwardFields({ resp, disabled, onPatch }: PartProps): ReactElement {
  const [to, setTo] = useMirror(resp.proxy.to);

  return (
    <>
      <Field
        label="Send the request to"
        hint="Matching requests go to this service, and its reply is handed back to whatever is being tested."
      >
        <Input
          mono
          value={to}
          disabled={disabled}
          aria-label="Send the request to"
          placeholder="https://apigw-test.example.com"
          onChange={(e) => {
            const next = e.currentTarget.value;
            setTo(next);
            onPatch({ proxy: { ...resp.proxy, to: next } });
          }}
        />
      </Field>

      <Field
        label="How often it forwards"
        /* One sentence for three modes, and it was only true of proxyOnce. Transparent
           saves nothing; proxyAlways saves behind the proxy stub, so the proxy keeps
           winning and nothing is ever replayed. It also contradicted the option label
           sitting right above it, "Pass through and record nothing". */
        hint={PROXY_MODE_HINT[resp.proxy.mode]}
      >
        <Select
          value={resp.proxy.mode}
          disabled={disabled}
          aria-label="How often it forwards"
          onChange={(e) =>
            onPatch({
              proxy: { ...resp.proxy, mode: e.currentTarget.value as MbProxyMode },
            })
          }
        >
          {FORWARD_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Recorded requests must match on"
        hint={
          resp.proxy.mode === 'proxyTransparent'
            ? 'Nothing is saved in this mode, so these have no effect.'
            : RECORDED_PARTS.some((part) => part.on(resp.proxy))
              ? 'The parts you tick become the conditions of the saved answer, so it replies to these requests and no others.'
              : /* predicates: [] answers everything — the opposite of what the old
                   sentence promised, and one click away in four places. */
                'Nothing ticked — the saved answer will have no conditions and will reply to every request.'
        }
      >
        <div className={styles.switches}>
          {RECORDED_PARTS.map((part) => (
            <Switch
              key={part.key}
              checked={resp.proxy[part.key]}
              label={part.label}
              disabled={disabled}
              onChange={(on) => onPatch({ proxy: part.set(resp.proxy, on) })}
            />
          ))}
        </div>
      </Field>

      <Field>
        <Switch
          checked={resp.proxy.addWait}
          label="Keep the real service's latency on replay"
          disabled={disabled}
          title="Records how long the real service took and waits the same before replaying."
          onChange={(on) => onPatch({ proxy: { ...resp.proxy, addWait: on } })}
        />
      </Field>
    </>
  );
}

/* ───────────────────────────────  javascript  ──────────────────────────── */

function ScriptFields({
  resp,
  disabled,
  injectionAllowed,
  onPatch,
}: PartProps & { injectionAllowed: boolean }): ReactElement {
  const [source, setSource] = useMirror(resp.inject);

  return (
    <>
      {injectionAllowed ? null : (
        <Strip
          tone="warn"
          icon={<Icon name="alert" />}
          title="This instance will reject a JavaScript answer"
        >
          Mountebank is running without <span className="mono">--allowInjection</span>, so saving
          this stub fails until injection is switched on.
        </Strip>
      )}
      <Field
        label="JavaScript"
        hint={
          <>
            Receives <span className="mono">request</span>, <span className="mono">state</span> and{' '}
            <span className="mono">logger</span>. Return the answer to send back.
          </>
        }
      >
        <CodeEditor
          language="js"
          value={source}
          height={300}
          readOnly={disabled}
          onChange={
            disabled
              ? undefined
              : (next) => {
                  setSource(next);
                  onPatch({ inject: next });
                }
          }
        />
      </Field>
    </>
  );
}

/* ─────────────────────────  delay and other steps  ─────────────────────── */

function StepLine({
  behavior,
  disabled,
  onValue,
  onRemove,
}: {
  behavior: Behavior;
  disabled: boolean;
  onValue: (next: string) => void;
  onRemove: () => void;
}): ReactElement {
  const spec = STEP_SPEC[behavior.type];
  const editable = isTextStep(behavior.value);
  const [text, setText] = useMirror(stepText(behavior.value));

  return (
    <div className={styles.step}>
      <Pill tone="acc">{spec.label}</Pill>
      <Input
        mono
        value={text}
        // a `copy` or `lookup` written as an object cannot be edited on one line
        // without silently flattening it to text — the JSON view owns those
        disabled={disabled || !editable}
        placeholder={spec.placeholder}
        title={editable ? spec.hint : 'This step holds structured JSON — edit it in the JSON view.'}
        aria-label={`${spec.label} value`}
        onChange={(e) => {
          const next = e.currentTarget.value;
          setText(next);
          onValue(next);
        }}
      />
      <Button
        variant="ghost"
        iconOnly
        icon={<Icon name="x" />}
        disabled={disabled}
        onClick={onRemove}
        title="Remove this step"
        aria-label="Remove this step"
      />
    </div>
  );
}

function AddStep({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (type: MbBehaviorName) => void;
}): ReactElement {
  const [open, setOpen] = useState<boolean>(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent): void {
      const node = wrap.current;
      if (node !== null && event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.menuWrap} ref={wrap}>
      <Button
        size="sm"
        icon={<Icon name="plus" />}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Add Step
      </Button>
      {open ? (
        <div className={styles.menu} role="menu">
          {ADDABLE_STEPS.map((type) => (
            <Button
              key={type}
              variant="ghost"
              size="sm"
              role="menuitem"
              className={styles.menuItem}
              title={STEP_SPEC[type].hint}
              onClick={() => {
                setOpen(false);
                onAdd(type);
              }}
            >
              {STEP_SPEC[type].action}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The delay, and anything else that happens after the answer is built.
 *
 * A wait is not presented as a "behavior" at all — it is the milliseconds row.
 * Clearing that row deletes the underlying behavior rather than storing a zero,
 * so a stub that never had one does not grow one by being opened.
 */
function StepFields({ resp, disabled, onPatch }: PartProps): ReactElement {
  const waitAt = resp.behaviors.findIndex((b) => b.type === 'wait');
  const waiting = waitAt < 0 ? null : resp.behaviors[waitAt];
  const [ms, setMs] = useMirror(waiting === null ? '' : stepText(waiting.value));

  const steps = resp.behaviors
    .map((behavior, index) => ({ behavior, index }))
    // a second `wait` is a rule this row cannot show, so it stays in the list
    .filter((entry) => entry.index !== waitAt);

  function editWait(next: string): void {
    setMs(next);

    if (next.trim() === '') {
      if (waitAt < 0) return;
      onPatch({ behaviors: resp.behaviors.filter((_, i) => i !== waitAt) });
      return;
    }

    const numeric = Number(next);
    const value: string | number = Number.isFinite(numeric) ? numeric : next;

    onPatch({
      behaviors:
        waitAt < 0
          ? [{ id: uid('b'), type: 'wait', value }, ...resp.behaviors]
          : resp.behaviors.map((b, i) => (i === waitAt ? { ...b, value } : b)),
    });
  }

  return (
    <>
      <Field
        label="Wait before answering"
        hint="Milliseconds to hold the answer back — how a slow service is imitated. Leave it empty to answer at once."
      >
        <div className={styles.statusRow}>
          <Input
            mono
            type="number"
            min={0}
            className={`num ${styles.short}`}
            value={ms}
            disabled={disabled}
            placeholder="0"
            aria-label="Wait before answering, in milliseconds"
            onChange={(e) => editWait(e.currentTarget.value)}
          />
          <span className={styles.unit}>ms</span>
        </div>
      </Field>

      <Field label="Other steps" hint="Rarely needed — most answers are sent exactly as written.">
        {steps.map((entry) => (
          <StepLine
            key={entry.behavior.id}
            behavior={entry.behavior}
            disabled={disabled}
            onValue={(next) =>
              onPatch({
                behaviors: resp.behaviors.map((b, i) =>
                  i === entry.index ? { ...b, value: next } : b,
                ),
              })
            }
            onRemove={() =>
              onPatch({ behaviors: resp.behaviors.filter((_, i) => i !== entry.index) })
            }
          />
        ))}
        <AddStep
          disabled={disabled}
          onAdd={(type) =>
            onPatch({ behaviors: [...resp.behaviors, { id: uid('b'), type, value: '' }] })
          }
        />
      </Field>
    </>
  );
}

/* ────────────────────────────────  one answer  ─────────────────────────── */

interface AnswerProps {
  resp: Resp;
  injectionAllowed: boolean;
  disabled: boolean;
  onPatch: (part: Partial<Resp>) => void;
}

function Answer({ resp, injectionAllowed, disabled, onPatch }: AnswerProps): ReactElement {
  const kinds: SegOption<RespType>[] = KINDS.map((kind) => ({
    value: kind.value,
    label: kind.label,
    icon: <Icon name={kind.icon} />,
  }));

  return (
    <div className={styles.answer}>
      <Seg
        value={resp.type}
        options={kinds}
        label="Kind of answer"
        onChange={(next) => {
          if (disabled || next === resp.type) return;
          onPatch({ type: next });
        }}
      />

      {resp.type === 'is' ? (
        <>
          <StatusField resp={resp} disabled={disabled} onPatch={onPatch} />
          <HeaderLines resp={resp} disabled={disabled} onPatch={onPatch} />
          <BodyField resp={resp} disabled={disabled} onPatch={onPatch} />
        </>
      ) : null}

      {resp.type === 'proxy' ? (
        <ForwardFields resp={resp} disabled={disabled} onPatch={onPatch} />
      ) : null}

      {resp.type === 'inject' ? (
        <ScriptFields
          resp={resp}
          disabled={disabled}
          injectionAllowed={injectionAllowed}
          onPatch={onPatch}
        />
      ) : null}

      {resp.type === 'fault' ? (
        <Field
          label="How it breaks"
          hint={FAULTS.find((f) => f.value === resp.fault)?.hint}
        >
          <Seg
            value={resp.fault}
            options={FAULTS.map((f) => ({ value: f.value, label: f.label }))}
            label="How it breaks"
            onChange={(next) => {
              if (disabled) return;
              onPatch({ fault: next });
            }}
          />
        </Field>
      ) : null}

      {/*
        * Mountebank runs no behaviors for a fault — there is no response object to
        * delay or decorate — so the rows are hidden rather than offered and ignored.
        * (`responseResolver.js`: behaviors execute unless the response is a proxy or
        * a fault.)
        */}
      {resp.type === 'fault' ? (
        <p className={styles.faultNote}>
          A fault has no response to delay, decorate or transform, so Mountebank runs no steps for
          it. Anything already on this response is kept, and ignored.
        </p>
      ) : (
        <StepFields resp={resp} disabled={disabled} onPatch={onPatch} />
      )}
    </div>
  );
}

/* ────────────────────────────────  the form  ───────────────────────────── */

export interface AnswerFormProps {
  responses: Resp[];
  onChange: (next: Resp[]) => void;
  /** From useConfig — warn when the instance would reject an injected response. */
  injectionAllowed: boolean;
  disabled?: boolean;
}

export function AnswerForm({
  responses,
  onChange,
  injectionAllowed,
  disabled = false,
}: AnswerFormProps): ReactElement {
  const [first, ...rest] = responses;

  return (
    <div className={styles.form}>
      {first === undefined ? (
        <p className={styles.lead}>
          {/* Mountebank refuses a stub whose `responses` is empty — 400, on every write
              endpoint — so this state has no runtime meaning at all, and calling it a
              bare 200 described the one thing it cannot do. */}
          This stub has no answers yet. Mountebank refuses to save a stub with none, so add
          one before saving.
        </p>
      ) : (
        <Answer
          resp={first}
          injectionAllowed={injectionAllowed}
          disabled={disabled}
          onPatch={(part) =>
            onChange(responses.map((resp, i) => (i === 0 ? { ...resp, ...part } : resp)))
          }
        />
      )}

      {/*
        A stub can hold several answers, which Mountebank serves in order and then
        starts over — that is how a 401-then-retry is rehearsed. Editing all of
        them in place turned this panel into a stack of numbered cards, so the form
        edits the first answer and the rest are reported here and kept untouched.
      */}
      {rest.length > 0 ? (
        <Strip tone="info" icon={<Icon name="clock" />} title="This stub answers in turn">
          {plural(responses.length, 'reply')} are served in order and start over at the end. The
          form above edits the first one; the {plural(rest.length, 'other')} are kept exactly as
          they are — open the JSON view to change them.
        </Strip>
      ) : null}
    </div>
  );
}
