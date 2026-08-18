import type { ComponentPropsWithRef, ReactNode } from 'react';

import styles from './Controls.module.css';

export interface FieldProps {
  label?: ReactNode;
  /** Explanatory line, rendered *below* the control as in the prototype. */
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}

/** Label → control → hint, stacked. The label must stay a direct child. */
export function Field({ label, hint, htmlFor, children }: FieldProps) {
  return (
    <div className={styles.field}>
      {label !== undefined ? <label htmlFor={htmlFor}>{label}</label> : null}
      {children}
      {hint !== undefined ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  );
}

export type InputProps = ComponentPropsWithRef<'input'> & { mono?: boolean };

export function Input({ mono = false, className, ...rest }: InputProps) {
  return (
    <input
      className={[styles.inp, mono ? styles.mono : '', className ?? ''].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}

export type SelectProps = ComponentPropsWithRef<'select'>;

export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <select className={[styles.sel, className ?? ''].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  );
}

export type TextareaProps = ComponentPropsWithRef<'textarea'>;

/** Always mono — it only ever holds JSON, headers or code fragments. */
export function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea className={[styles.ta, className ?? ''].filter(Boolean).join(' ')} {...rest} />;
}
