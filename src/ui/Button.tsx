import type { ButtonHTMLAttributes, ReactNode } from 'react';

import styles from './Button.module.css';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon, rendered before the label exactly as in the prototype. */
  icon?: ReactNode;
  /** Square padding for icon-only controls. Always pair with title + aria-label. */
  iconOnly?: boolean;
}

const LOCAL: Record<ButtonVariant, string | undefined> = {
  default: '',
  primary: styles.pri,
  ghost: styles.ghost,
  danger: styles.danger,
};

/**
 * Contextual overrides in the prototype are written as descendant selectors —
 * `.side .btn--ghost`, `.ed__bar .btn`, `.row-acts .btn`. CSS Modules hash the
 * local class, so a stable global hook rides along for those call sites to
 * target. The hooks carry no styles of their own.
 */
const HOOK: Record<ButtonVariant, string> = {
  default: '',
  primary: 'btn--pri',
  ghost: 'btn--ghost',
  danger: 'btn--danger',
};

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  iconOnly = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    'btn',
    HOOK[variant],
    size === 'sm' ? 'btn--sm' : '',
    iconOnly ? 'btn--icon' : '',
    styles.btn,
    LOCAL[variant],
    size === 'sm' ? styles.sm : '',
    iconOnly ? styles.iconOnly : '',
    className ?? '',
  ]
    .filter((c): c is string => Boolean(c))
    .join(' ');

  return (
    <button type={type} className={cls} {...rest}>
      {icon}
      {children}
    </button>
  );
}
