import styles from './Switch.module.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible label. Always present — the switch is never a bare track. */
  label: string;
  disabled?: boolean;
  /** Optional tooltip, as the prototype puts on "Record requests". */
  title?: string;
}

export function Switch({ checked, onChange, label, disabled = false, title }: SwitchProps) {
  return (
    <label
      className={[styles.switch, disabled ? styles.disabled : ''].filter(Boolean).join(' ')}
      title={title}
    >
      <input
        className={styles.input}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span className={styles.track} />
      {/* stable hook: the sidebar dims switch labels via `.side .switch__txt` */}
      <span className={`switch__txt ${styles.txt}`}>{label}</span>
    </label>
  );
}
