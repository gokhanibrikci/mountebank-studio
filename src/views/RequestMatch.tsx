/**
 * The "when" side of a stub, drawn as the shape of an HTTP request.
 *
 * The old editor asked people to build a query: pick a field, pick an operator,
 * type a value, then wrap the lot in AND/OR/NOT boxes. This screen asks the only
 * two questions that matter first — which method, which path — and then lets
 * query params, headers and the body be ordinary lines underneath.
 *
 * Nothing here interprets Mountebank on its own: the projection lives in
 * lib/mb/simpleForm.ts, which is round-trip tested against the real dev stubs.
 * This file only renders a SimpleForm and hands back a NEW one on every edit —
 * the incoming form is never mutated.
 *
 * Two honesty rules the layout exists to serve:
 *   · a value's JSON type is always visible, because mountebank compares by type
 *     and "42" never matches 42;
 *   · rules the plain form cannot say are shown as "extra rules" and kept
 *     verbatim, never quietly dropped.
 */

import { useId } from 'react';
import type { ReactElement } from 'react';

import { guessType } from '../lib/mb/model';
import { BODY_MODES, PATH_MODES, describeExtra, mkKeyMatch } from '../lib/mb/simpleForm';
import type { BodyMode, KeyMatch, PathMode, SimpleForm } from '../lib/mb/simpleForm';
import { Button, Field, Icon, Input, Seg, Select, Verb } from '../ui';
import type { SegOption } from '../ui';
import type { ValueType } from '../lib/mb/types';

import styles from './RequestMatch.module.css';

/** The verbs worth offering. '' is "any method" and is not a verb. */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

const TYPE_OPTIONS: SegOption<ValueType>[] = [
  { value: 'string', label: 'str' },
  { value: 'number', label: 'num' },
  { value: 'boolean', label: 'bool' },
  { value: 'json', label: 'json' },
];

const TYPE_CHIP: Record<ValueType, string> = {
  string: 'str',
  number: 'num',
  boolean: 'bool',
  json: 'json',
};

const TYPE_WORD: Record<ValueType, string> = {
  string: 'text',
  number: 'a number',
  boolean: 'true or false',
  json: 'JSON',
};

const BODY_VALUE_LABEL: Record<Exclude<BodyMode, 'any'>, string> = {
  contains: 'Text the body must contain',
  equals: 'The whole body',
  field: 'Must equal',
};

/** A pattern that does not compile matches nothing, so it is reported as it is typed. */
function patternError(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'not a valid regular expression';
  }
}

const replaceLine = (lines: KeyMatch[], id: string, patch: Partial<KeyMatch>): KeyMatch[] =>
  lines.map((line) => (line.id === id ? { ...line, ...patch } : line));

/* ────────────────────────────  the value type control  ─────────────────── */

interface TypePickerProps {
  value: ValueType;
  /** The text being typed, so a better type can be offered — never applied. */
  text: string;
  label: string;
  onChange: (next: ValueType) => void;
}

function TypePicker({ value, text, label, onChange }: TypePickerProps): ReactElement {
  const guess = guessType(text);
  const offer = text !== '' && guess !== value;

  return (
    <fieldset className={[styles.gate, styles.types].join(' ')}>
      <Seg value={value} onChange={onChange} options={TYPE_OPTIONS} label={label} />
      {offer ? (
        <button
          type="button"
          className={styles.suggest}
          onClick={() => onChange(guess)}
          title={`This looks like ${TYPE_WORD[guess]} — click to compare it as ${TYPE_WORD[guess]}.`}
        >
          {TYPE_CHIP[guess]}?
        </button>
      ) : null}
    </fieldset>
  );
}

/* ─────────────────────────  query params and headers  ───────────────────── */

interface KeyLinesProps {
  title: string;
  /** Singular, for the remove tooltip: "Remove this parameter". */
  noun: string;
  lines: KeyMatch[];
  empty: string;
  addLabel: string;
  keyLabel: string;
  keyPlaceholder: string;
  valueLabel: string;
  valuePlaceholder: string;
  onChange: (next: KeyMatch[]) => void;
}

function KeyLines({
  title,
  noun,
  lines,
  empty,
  addLabel,
  keyLabel,
  keyPlaceholder,
  valueLabel,
  valuePlaceholder,
  onChange,
}: KeyLinesProps): ReactElement {
  return (
    <section className={styles.block}>
      <h4>{title}</h4>

      {lines.length === 0 ? (
        <p className={styles.hint}>{empty}</p>
      ) : (
        <div className={styles.lines}>
          {lines.map((line) => (
            <div className={styles.kv} key={line.id}>
              <Input
                mono
                value={line.key}
                placeholder={keyPlaceholder}
                aria-label={keyLabel}
                onChange={(e) =>
                  onChange(replaceLine(lines, line.id, { key: e.currentTarget.value }))
                }
              />
              <div className={styles.cell}>
                <Input
                  mono
                  className={styles.cellInput}
                  value={line.value}
                  placeholder={valuePlaceholder}
                  aria-label={valueLabel}
                  onChange={(e) =>
                    onChange(replaceLine(lines, line.id, { value: e.currentTarget.value }))
                  }
                />
                <TypePicker
                  value={line.type}
                  text={line.value}
                  label={`${valueLabel} is compared as`}
                  onChange={(type) => onChange(replaceLine(lines, line.id, { type }))}
                />
              </div>
              <Button
                variant="ghost"
                iconOnly
                icon={<Icon name="x" />}
                title={`Remove this ${noun}`}
                aria-label={`Remove this ${noun}`}
                onClick={() => onChange(lines.filter((other) => other.id !== line.id))}
              />
            </div>
          ))}
        </div>
      )}

      <div className={styles.add}>
        <Button
          size="sm"
          icon={<Icon name="plus" />}
          onClick={() => onChange([...lines, mkKeyMatch()])}
        >
          {addLabel}
        </Button>
      </div>
    </section>
  );
}

/* ────────────────────────────────  the form  ───────────────────────────── */

export interface RequestMatchProps {
  form: SimpleForm;
  onChange: (next: SimpleForm) => void;
}

export function RequestMatch({ form, onChange }: RequestMatchProps): ReactElement {
  const methodId = useId();
  const pathId = useId();
  const pathModeId = useId();
  const bodyFieldId = useId();
  const bodyValueId = useId();

  const path = form.path.trim();
  const badPattern = form.pathMode === 'regex' && path !== '' ? patternError(form.path) : null;
  const bodyMode = BODY_MODES.find((m) => m.value === form.bodyMode);

  return (
    <div className={styles.wrap}>
      <p className={styles.lead}>
        A request has to match every line below before this stub answers it, and anything left empty
        is not looked at. Values are compared by type, so the text 42 never matches the number 42 —
        the small str · num · bool · json control beside a value says which you mean.
      </p>

      {/* ---- the request line: method and path ---- */}
      <section className={styles.block}>
        <div className={styles.reqLine}>
          <Field label="Method" htmlFor={methodId}>
            <div className={styles.methodRow}>
              <Select
                id={methodId}
                className={styles.methodSel}
                value={form.method}
                onChange={(e) => onChange({ ...form, method: e.currentTarget.value })}
              >
                <option value="">Any method</option>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
              <Verb method={form.method === '' ? 'ANY' : form.method} />
            </div>
          </Field>

          <Field
            label="Path"
            htmlFor={pathId}
            hint={
              badPattern !== null ? (
                <span className={styles.bad}>
                  <Icon name="alert" />
                  That pattern will not compile ({badPattern}), so this stub matches nothing until
                  it is fixed.
                </span>
              ) : path === '' ? (
                'Leave this empty and any path matches.'
              ) : form.pathMode === 'regex' ? (
                'A JavaScript regular expression, tested against the path.'
              ) : undefined
            }
          >
            <div className={styles.pathRow}>
              <Select
                id={pathModeId}
                className={styles.pathMode}
                value={form.pathMode}
                aria-label="How the path is compared"
                onChange={(e) => onChange({ ...form, pathMode: e.currentTarget.value as PathMode })}
              >
                {PATH_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
              <Input
                id={pathId}
                mono
                className={styles.pathInput}
                value={form.path}
                placeholder="/v1/card/get-credit-card-info-basic"
                onChange={(e) => onChange({ ...form, path: e.currentTarget.value })}
              />
            </div>
          </Field>
        </div>
      </section>

      {/* ---- query parameters ---- */}
      <KeyLines
        title="Query parameters"
        noun="parameter"
        lines={form.query}
        empty="No query parameters — the query string is not looked at."
        addLabel="Add Parameter"
        keyLabel="Parameter name"
        keyPlaceholder="bank"
        valueLabel="Parameter value"
        valuePlaceholder="eu"
        onChange={(query) => onChange({ ...form, query })}
      />

      {/* ---- headers ---- */}
      <KeyLines
        title="Headers"
        noun="header"
        lines={form.headers}
        empty="No headers — headers are not looked at."
        addLabel="Add Header"
        keyLabel="Header name"
        keyPlaceholder="Authorization"
        valueLabel="Header value"
        valuePlaceholder="Basic dXNlcjpwYXNz"
        onChange={(headers) => onChange({ ...form, headers })}
      />

      {/* ---- body ---- */}
      <section className={styles.block}>
        <h4>Body</h4>

        <fieldset className={styles.gate}>
          <Seg
            value={form.bodyMode}
            onChange={(mode) => onChange({ ...form, bodyMode: mode })}
            options={BODY_MODES.map((m) => ({ value: m.value, label: m.label }))}
            label="How the body is matched"
          />
        </fieldset>

        {bodyMode !== undefined ? <p className={styles.hint}>{bodyMode.hint}</p> : null}

        {form.bodyMode === 'field' ? (
          <Field
            label="JSON field"
            htmlFor={bodyFieldId}
            hint="A jsonpath selector, applied to the body before the comparison."
          >
            <Input
              id={bodyFieldId}
              mono
              value={form.bodyField}
              placeholder="$..customerRef"
              onChange={(e) => onChange({ ...form, bodyField: e.currentTarget.value })}
            />
          </Field>
        ) : null}

        {form.bodyMode !== 'any' ? (
          <Field label={BODY_VALUE_LABEL[form.bodyMode]} htmlFor={bodyValueId}>
            <div className={styles.cell}>
              <Input
                id={bodyValueId}
                mono
                className={styles.cellInput}
                value={form.bodyValue}
                placeholder={form.bodyMode === 'field' ? '11111111110' : '{"cardNumber":"…"}'}
                onChange={(e) => onChange({ ...form, bodyValue: e.currentTarget.value })}
              />
              <TypePicker
                value={form.bodyType}
                text={form.bodyValue}
                label="The body value is compared as"
                onChange={(bodyType) => onChange({ ...form, bodyType })}
              />
            </div>
          </Field>
        ) : null}
      </section>

      {/* ---- rules the plain form cannot say ---- */}
      {form.extras.length > 0 ? (
        <section className={styles.block}>
          <h4>Extra rules</h4>
          <p className={styles.note}>
            These came from this stub&rsquo;s JSON and the form above cannot show them — an or/not
            group, a case-sensitive comparison, or a rule this editor does not model. They are kept
            exactly as they are and saved unchanged. Remove one only if you mean to lose it; the
            JSON view is the place to edit it.
          </p>
          <ul className={styles.extras}>
            {form.extras.map((extra) => {
              const text = describeExtra(extra);
              return (
                <li className={styles.extra} key={extra.id}>
                  <Icon name="code" />
                  <span className={styles.extraText} title={text}>
                    {text}
                  </span>
                  <Button
                    variant="ghost"
                    iconOnly
                    icon={<Icon name="x" />}
                    title="Remove this rule"
                    aria-label={`Remove this rule: ${text}`}
                    onClick={() =>
                      onChange({
                        ...form,
                        extras: form.extras.filter((other) => other.id !== extra.id),
                      })
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
