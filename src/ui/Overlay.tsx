import type { ReactNode } from 'react';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { Button } from './Button';
import { Icon } from './Icon';
import styles from './Overlay.module.css';

/* ══════════════════════════════════════════════════════════════
   Shared scrim registry.

   Only ONE scrim ever exists, and it is owned by the overlay that
   arrived first. Ownership survives a later overlay closing, and the
   scrim stays lit while *any* registered overlay is open — so closing a
   modal on top of an open drawer never un-scrims the drawer.

   Entries live from mount to unmount, which includes the exit
   transition; that is what lets the scrim fade out instead of vanishing.
   ══════════════════════════════════════════════════════════════ */

interface Entry {
  id: string;
  open: boolean;
  close: () => void;
}

interface Snapshot {
  /** Registration order. `ids[0]` owns the scrim. */
  ids: string[];
  anyOpen: boolean;
}

let entries: Entry[] = [];
let snapshot: Snapshot = { ids: [], anyOpen: false };
const listeners = new Set<() => void>();

function publish(): void {
  snapshot = {
    ids: entries.map((e) => e.id),
    anyOpen: entries.some((e) => e.open),
  };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

/** Escape closes the topmost *open* overlay, modal before drawer. */
function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  const topmost = [...entries].reverse().find((entry) => entry.open);
  if (topmost === undefined) return;
  e.stopPropagation();
  topmost.close();
}

function mountEntry(id: string, close: () => void): void {
  entries = [...entries, { id, open: false, close }];
  if (entries.length === 1) document.addEventListener('keydown', onKeyDown);
  publish();
}

function unmountEntry(id: string): void {
  entries = entries.filter((e) => e.id !== id);
  if (entries.length === 0) document.removeEventListener('keydown', onKeyDown);
  publish();
}

function setEntryOpen(id: string, open: boolean): void {
  let changed = false;
  entries = entries.map((e) => {
    if (e.id !== id || e.open === open) return e;
    changed = true;
    return { ...e, open };
  });
  if (changed) publish();
}

/** A click on the bare scrim dismisses everything it covers. */
function closeAll(): void {
  for (const e of [...entries].reverse()) if (e.open) e.close();
}

interface OverlayState {
  /** In the DOM (open, or animating out). */
  mounted: boolean;
  /** Has the `on` class — drives the transition in and out. */
  shown: boolean;
  /** This overlay renders the single shared scrim. */
  ownsScrim: boolean;
  /** Some overlay is open, so the scrim should be lit. */
  scrimLit: boolean;
}

function useOverlay(open: boolean, onClose: () => void, exitMs: number): OverlayState {
  const id = useId();
  const closeRef = useRef(onClose);
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // mount immediately, then flip `on` one frame later so the transition runs
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);

  // registration order decides scrim ownership — declared before the open sync
  useEffect(() => {
    if (!mounted) return;
    mountEntry(id, () => closeRef.current());
    return () => unmountEntry(id);
  }, [mounted, id]);

  useEffect(() => {
    if (!mounted) return;
    setEntryOpen(id, open);
  }, [mounted, open, id]);

  const store = useSyncExternalStore(subscribe, getSnapshot);

  return {
    mounted,
    shown,
    ownsScrim: store.ids[0] === id,
    scrimLit: store.anyOpen,
  };
}

function Scrim({ lit }: { lit: boolean }) {
  return (
    <div
      className={[styles.scrim, lit ? styles.scrimOn : ''].filter(Boolean).join(' ')}
      onClick={closeAll}
    />
  );
}

/* ══════════════════════════════════════════════════════════════
   Drawer — the right-hand editing surface
   ══════════════════════════════════════════════════════════════ */

const DRAWER_EXIT_MS = 230;

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Mono sub-line under the title, e.g. `POST /v1/token`. */
  subtitle?: ReactNode;
  /** Controls beside the close button, e.g. a status pill or a Visual/JSON Seg. */
  tools?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function Drawer({ open, onClose, title, subtitle, tools, footer, children }: DrawerProps) {
  const { mounted, shown, ownsScrim, scrimLit } = useOverlay(open, onClose, DRAWER_EXIT_MS);
  const titleId = useId();

  if (!mounted) return null;

  return createPortal(
    <>
      {ownsScrim ? <Scrim lit={scrimLit} /> : null}
      <aside
        className={[styles.drawer, shown ? styles.drawerOn : ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={styles.head}>
          <div className={styles.title}>
            <h2 id={titleId}>{title}</h2>
            {subtitle !== undefined ? <p>{subtitle}</p> : null}
          </div>
          <div className={styles.spacer} />
          {tools !== undefined ? <div className={styles.tools}>{tools}</div> : null}
          <Button
            variant="ghost"
            iconOnly
            title="Close"
            aria-label="Close"
            icon={<Icon name="x" />}
            onClick={onClose}
          />
        </div>
        <div className={styles.body}>{children}</div>
        {footer !== undefined ? <div className={styles.foot}>{footer}</div> : null}
      </aside>
    </>,
    document.body,
  );
}

/* ══════════════════════════════════════════════════════════════
   Modal — short, centred decisions
   ══════════════════════════════════════════════════════════════ */

const MODAL_EXIT_MS = 200;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({ open, onClose, title, subtitle, footer, children }: ModalProps) {
  const { mounted, shown, ownsScrim, scrimLit } = useOverlay(open, onClose, MODAL_EXIT_MS);
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // the prototype drops focus straight into the first control
  useEffect(() => {
    if (!open) return;
    const first = bodyRef.current?.querySelector<HTMLElement>('input, select, textarea');
    first?.focus();
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <>
      {ownsScrim ? <Scrim lit={scrimLit} /> : null}
      {/* the sheet covers the scrim, so a backdrop click is handled here */}
      <div
        className={[styles.modal, shown ? styles.modalOn : ''].filter(Boolean).join(' ')}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className={styles.mhead}>
            <h2 id={titleId}>{title}</h2>
            {subtitle !== undefined ? <p>{subtitle}</p> : null}
          </div>
          <div className={styles.mbody} ref={bodyRef}>
            {children}
          </div>
          {footer !== undefined ? <div className={styles.mfoot}>{footer}</div> : null}
        </div>
      </div>
    </>,
    document.body,
  );
}
