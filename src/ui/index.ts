/**
 * The primitive library — a faithful port of the approved prototype's design
 * system. Screens compose from these and never write chrome of their own.
 *
 * Every colour, font, radius, shadow and type step resolves to a token from
 * src/styles/tokens.css.
 */

export { Button } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button';

export { Pill, Verb, Off } from './Chips';
export type { OffProps, PillProps, PillTone, VerbProps } from './Chips';

export { CodeEditor } from './CodeEditor';
export type { CodeEditorProps } from './CodeEditor';

export { Field, Input, Select, Textarea } from './Controls';
export type { FieldProps, InputProps, SelectProps, TextareaProps } from './Controls';

export { Icon } from './Icon';
export type { IconName, IconProps } from './Icon';

export { Drawer, Modal } from './Overlay';
export type { DrawerProps, ModalProps } from './Overlay';

export { EmptyState, PageHead, Summary } from './Page';
export type { EmptyStateProps, PageHeadProps, SummaryProps } from './Page';

export { Card, Section } from './Panels';
export type { CardProps, SectionProps } from './Panels';

export { Seg } from './Seg';
export type { SegOption, SegProps } from './Seg';

export { Switch } from './Switch';
export type { SwitchProps } from './Switch';

export { Table } from './Table';
export type { TableProps } from './Table';

export { Toasts } from './Toasts';

export { escapeHtml, highlight, hlJS, hlJSON } from './highlight';
export { Strip, type StripProps, type StripTone } from './Strip';
