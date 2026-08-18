/**
 * What to say when a read fails.
 *
 * Every screen that reads an instance needs the same sentence, and getting it
 * right is not a matter of wording: a cross-origin failure arrives with its cause
 * withheld, so the panel has to earn the answer with a second request
 * (`lib/mb/reach.ts`) before it can name one. This component is where that
 * happens, so no screen has to remember to do it — and so the panel never again
 * offers a list of three things one of which might be wrong.
 *
 * There used to be a button here, offering to repoint the environment at a path
 * this host forwards. It is gone because the panel no longer waits to be told:
 * routing is resolved from the deployment's own map before the first request
 * (`resolveTarget`), so a forwarded instance is simply reached, and this block only
 * ever reports what nobody can fix from inside the page.
 *
 * It renders inline text only, because its callers are a Strip's sentence, an
 * EmptyState's body and a paragraph.
 */

import type { ReactNode } from 'react';

import { describeError } from '../lib/mb/client';
import { useCause } from '../lib/mb/reach';
import styles from './Failure.module.css';

export interface FailureProps {
  /** The admin API this failure is about — what gets probed. */
  target: string;
  error: unknown;
  /**
   * A clause the screen wants to add, e.g. what it did NOT do. Shown after the
   * cause, since it is true either way.
   */
  children?: ReactNode;
}

export function Failure({ target, error, children }: FailureProps) {
  const cause = useCause(target, error);

  return (
    <>
      {cause === null ? describeError(error) : cause.text}
      {cause?.command === undefined ? null : (
        <>
          {' '}
          Start it with <code className={styles.cmd}>{cause.command}</code>
        </>
      )}
      {children === undefined ? null : <> {children}</>}
    </>
  );
}
