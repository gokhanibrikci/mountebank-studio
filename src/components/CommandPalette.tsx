/**
 * ⌘K — one keystroke to anywhere.
 *
 * The palette indexes four kinds of thing: environments, views, every imposter,
 * and every stub in every imposter. Stubs are the reason it exists: two stubs on
 * one path routinely differ only by a body condition, so a stub's hint carries
 * the first condition value that is neither method nor path — the thing that
 * actually tells them apart.
 *
 * It stays mounted while closed, because the ⌘K listener has to be live even
 * when there is nothing on screen.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';

import type { EnvId } from '../lib/environments';
import { isOpaque } from '../lib/mb/reach';
import { useImposters } from '../lib/queries';
import { sigOf } from '../lib/summaries';
import type { Stub } from '../lib/mb/types';
import { useEnvironments } from '../store/useEnvironments';
import { useStudio } from '../store/useStudio';
import { Icon, type IconName } from '../ui';
import styles from './CommandPalette.module.css';

export interface CommandPaletteProps {
  env: EnvId;
}

interface Item {
  key: string;
  label: string;
  hint: string;
  icon: IconName;
  run: () => void;
}

const VIEWS: { slug: string; label: string; icon: IconName }[] = [
  { slug: 'overview', label: 'Overview', icon: 'dash' },
  { slug: 'imposters', label: 'Imposters', icon: 'imps' },
  { slug: 'activity', label: 'Activity', icon: 'act' },
  { slug: 'settings', label: 'Settings', icon: 'cog' },
];

const EXIT_MS = 180;
const MAX_ROWS = 40;

const hostOf = (target: string): string => {
  try {
    return new URL(target).host;
  } catch {
    return target;
  }
};

/**
 * The condition that distinguishes this stub from its siblings on the same path.
 * Method and path are already in the label, so they are skipped; group and raw
 * predicates have no single value worth quoting.
 */
function distinguishingValue(stub: Stub): string {
  for (const pred of stub.predicates) {
    if (pred.kind !== 'simple') continue;
    for (const c of pred.conditions) {
      if (c.field === 'method' || c.field === 'path') continue;
      if (!c.value) continue;
      return c.value.length > 22 ? `${c.value.slice(0, 22)}…` : c.value;
    }
  }
  return '';
}

export function CommandPalette({ env }: CommandPaletteProps) {
  /* The user's own list, live: an environment added while the palette is open is
     in the index the next time it opens, and a deleted one is gone from it. */
  const environments = useEnvironments((s) => s.list);
  const environment = environments.find((e) => e.id === env);

  const location = useLocation();
  const navigate = useNavigate();

  const open = useStudio((s) => s.paletteOpen);
  const setOpen = useStudio((s) => s.setPaletteOpen);
  const setEnv = useStudio((s) => s.setEnv);

  const imposters = useImposters(env);

  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  const baseId = useId();

  /* ---- ⌘K is global and always live ---- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useStudio.getState().paletteOpen);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  /* ---- mount now, transition one frame later; unmount after the fade ---- */
  useEffect(() => {
    if (open) {
      setMounted(true);
      setQuery('');
      setSelected(0);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (shown) inputRef.current?.focus();
  }, [shown]);

  /* ---- closing hands focus back to whatever opened it ---- */
  useEffect(() => {
    if (open) {
      returnRef.current = document.activeElement as HTMLElement | null;
      return;
    }
    returnRef.current?.focus();
    returnRef.current = null;
  }, [open]);

  /* ---- the index ---- */
  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => {
      void navigate(to);
    };
    const out: Item[] = [];

    // environments first: the most consequential jump in the app. Switching keeps
    // you on the same screen, so only the prefix changes. With one environment
    // defined — or none — there is nothing to switch to and no row appears.
    for (const e of environments) {
      if (e.id === env) continue;
      const rest = location.pathname.replace(/^\/[^/]+/, '') || '/overview';
      out.push({
        key: `env:${e.id}`,
        label: e.label,
        hint: `Environment · ${hostOf(e.target)}`,
        icon: 'globe',
        run: () => {
          setEnv(e.id);
          void navigate(`/${e.id}${rest}`);
        },
      });
    }

    // the four screens, plus Settings
    for (const v of VIEWS) {
      out.push({
        key: `view:${v.slug}`,
        label: v.label,
        hint: 'Go',
        icon: v.icon,
        run: go(`/${env}/${v.slug}`),
      });
    }

    // every imposter in this environment
    for (const imposter of imposters.data ?? []) {
      out.push({
        key: `imp:${imposter.port}`,
        label: imposter.name,
        hint: `Imposter · port ${imposter.port}`,
        icon: 'imps',
        run: go(`/${env}/imposters/${imposter.port}`),
      });
    }

    // and every stub, which is what the palette is really for
    for (const imposter of imposters.data ?? []) {
      imposter.stubs.forEach((stub, index) => {
        const sig = sigOf(stub);
        const tell = distinguishingValue(stub);
        out.push({
          key: `stub:${imposter.port}:${index}`,
          label: `${sig.method} ${sig.path}`,
          hint: `Stub · ${imposter.name}${tell ? ` · ${tell}` : ''}`,
          icon: 'code',
          run: go(`/${env}/imposters/${imposter.port}?stub=${index}`),
        });
      });
    }

    return out;
  }, [env, environments, imposters.data, location.pathname, navigate, setEnv]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? items.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(q))
      : items;
    return matches.slice(0, MAX_ROWS);
  }, [items, query]);

  const index = filtered.length === 0 ? 0 : Math.min(selected, filtered.length - 1);

  // keep the highlighted row in view when arrowing past the fold
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [index, query]);

  const runItem = (item: Item) => {
    setOpen(false);
    item.run();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(Math.min(index + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(Math.max(index - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[index];
      if (item) runItem(item);
    }
  };

  if (!mounted) return null;

  const listId = `${baseId}-list`;
  /* Named in the footer. The environment can be deleted while the palette is
     open, and there is no name to quote then. */
  const where = environment?.label ?? 'this environment';

  return createPortal(
    <>
      <div
        className={[styles.scrim, shown ? styles.scrimOn : ''].filter(Boolean).join(' ')}
        onClick={() => setOpen(false)}
      />
      <div className={[styles.palette, shown ? styles.on : ''].filter(Boolean).join(' ')}>
        <div className={styles.panel} role="dialog" aria-modal="true" aria-label="Command palette">
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            placeholder="Jump to an imposter, stub or screen…"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={true}
            aria-controls={listId}
            aria-activedescendant={filtered[index] ? `${baseId}-${index}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
          />

          <div className={styles.list} id={listId} role="listbox" ref={listRef}>
            {filtered.length === 0 ? (
              <p className={styles.note}>No matches</p>
            ) : (
              filtered.map((item, ix) => (
                <button
                  key={item.key}
                  type="button"
                  id={`${baseId}-${ix}`}
                  role="option"
                  aria-selected={ix === index}
                  className={`pres ${styles.row}`}
                  onMouseEnter={() => setSelected(ix)}
                  onClick={() => runItem(item)}
                >
                  <Icon name={item.icon} />
                  <span className={styles.label}>{item.label}</span>
                  <span className={styles.k}>{item.hint}</span>
                </button>
              ))
            )}
          </div>

          {/* the index is only as complete as the query behind it — say so */}
          {imposters.isPending ? (
            <p className={styles.foot}>Loading imposters and stubs from {where}…</p>
          ) : imposters.isError ? (
            <p className={styles.foot}>
              {isOpaque(imposters.error)
                ? `No answer from ${where}`
                : `${where} could not be read`}{' '}
              — imposters and stubs are missing from this list.
            </p>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  );
}
