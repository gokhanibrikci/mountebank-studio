import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';

import { highlight } from './highlight';
import styles from './CodeEditor.module.css';

export interface CodeEditorProps {
  value: string;
  onChange?: (next: string) => void;
  language: 'json' | 'js';
  /** Visible height of the scroll window in px. */
  height?: number;
  readOnly?: boolean;
  /** Right-aligned controls in the editor bar, e.g. a "Format JSON" button. */
  toolbar?: ReactNode;
}

/**
 * The prototype's editor, ported as-is: a transparent <textarea> laid exactly
 * over a tokenised <pre>, both inside one scrolling ancestor.
 *
 *   .scroll   fixed height, the only thing that scrolls
 *     .stack  position:relative, at least as tall as the scroll window
 *       .pre  paints the tokens and *defines the scroll height*
 *       .ta   position:absolute inset:0, transparent text, overflow:hidden
 *
 * Because the textarea cannot scroll on its own, caret movement scrolls the
 * shared ancestor and the two layers can never drift apart. Padding, font,
 * line-height and tab-size are declared identically on both layers.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  height = 220,
  readOnly = false,
  toolbar,
}: CodeEditorProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  /** Caret position to restore after a Tab-driven value change. */
  const caret = useRef<number | null>(null);

  const html = useMemo(() => highlight(value, language), [value, language]);

  useEffect(() => {
    const ta = taRef.current;
    if (caret.current === null || ta === null) return;
    ta.selectionStart = caret.current;
    ta.selectionEnd = caret.current;
    caret.current = null;
  });

  // A controlled textarea with no handler must be read-only, not silently inert.
  const locked = readOnly || onChange === undefined;

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Tab' || locked || onChange === undefined) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const next = ta.value.slice(0, start) + '  ' + ta.value.slice(ta.selectionEnd);
    caret.current = start + 2;
    onChange(next);
  }

  return (
    <div className={styles.ed} style={{ '--ed-h': `${height}px` } as CSSProperties}>
      <div className={`ed__bar ${styles.bar}`}>
        <span className={styles.lang}>{language}</span>
        <div className={styles.spacer} />
        {toolbar}
      </div>
      <div className={styles.scroll}>
        <div className={styles.stack}>
          <pre className={styles.pre} aria-hidden="true">
            <code dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
          <textarea
            ref={taRef}
            className={styles.ta}
            value={value}
            readOnly={locked}
            spellCheck={false}
            autoComplete="off"
            aria-label={language === 'js' ? 'JavaScript source' : 'JSON source'}
            onChange={(e) => onChange?.(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>
    </div>
  );
}
