import { useStudio } from '../store/useStudio';
import styles from './Toasts.module.css';

const TONE: Record<'ok' | 'warn' | 'err', string | undefined> = {
  ok: '',
  warn: styles.warn,
  err: styles.err,
};

/**
 * The live region for transient confirmations. Toasts are pushed with
 * `useStudio().toast(...)` and expire on their own, so nothing here is
 * interactive — a toast never carries the only copy of a message.
 */
export function Toasts() {
  const toasts = useStudio((s) => s.toasts);

  return (
    <div className={styles.toasts} aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[styles.toast, TONE[t.tone]].filter((c): c is string => Boolean(c)).join(' ')}
        >
          <span className={styles.dot} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
