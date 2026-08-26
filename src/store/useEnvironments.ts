/**
 * The environment list, owned by the browser.
 *
 * Persisted, because it is the user's own configuration and retyping a host on
 * every reload would be absurd. Seeded once from VITE_ENVIRONMENTS so a team can
 * ship the panel pre-pointed at their instances; after that the user's edits win
 * and the seed is never re-applied.
 *
 * `getState()` is deliberately usable outside React: src/lib/mb/client.ts needs a
 * target URL when it builds an axios instance, and that happens outside the tree.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import {
  normalise,
  adoptable,
  seedFromEnv,
  slugify,
  uniqueId,
  type EnvId,
  type MbEnvironment,
} from '../lib/environments';

export interface EnvironmentDraft {
  label: string;
  target: string;
  note?: string;
  /**
   * Set when the form had this host forward to the instance, because it answered and
   * refused this page. Not typed by anyone — it is the outcome of a request that
   * succeeded while testing, carried so the environment is saved knowing how it is read.
   */
  forwarded?: boolean;
}

interface EnvironmentsState {
  list: MbEnvironment[];
  /**
   * Adopt a list the host published, but ONLY when this browser has none of its own.
   * A user's edits always win: the point is a first run that works, not a server that
   * keeps overwriting what someone changed.
   *
   * Reports whether anything was adopted, because that is exactly the moment worth
   * greeting somebody on — see `greeted` in the studio store.
   */
  seed: (list: MbEnvironment[], reach?: (target: string) => string) => boolean;
  /**
   * The ids a host has already offered this browser, kept so an environment somebody
   * removed is not handed straight back on the next start.
   */
  offered: EnvId[];
  add: (draft: EnvironmentDraft) => MbEnvironment;
  update: (id: EnvId, patch: Partial<EnvironmentDraft>) => void;
  remove: (id: EnvId) => void;
  /**
   * Remember that this host was asked to forward to an environment's instance, so it can
   * be asked again after the host restarts and forgets. Not part of the draft a form
   * submits: nobody types this, it is the outcome of a request that succeeded.
   */
  markForwarded: (id: EnvId) => void;
}

export const useEnvironments = create<EnvironmentsState>()(
  persist(
    (set, get) => ({
      list: seedFromEnv(import.meta.env.VITE_ENVIRONMENTS as string | undefined),

      add: (draft) => {
        const created: MbEnvironment = {
          id: uniqueId(
            slugify(draft.label),
            get().list.map((e) => e.id),
          ),
          label: draft.label.trim(),
          target: normalise(draft.target),
          ...(draft.forwarded === true ? { forwarded: true } : {}),
          ...(draft.note !== undefined && draft.note !== '' ? { note: draft.note } : {}),
        };
        set({ list: [...get().list, created] });
        return created;
      },

      update: (id, patch) =>
        set({
          list: get().list.map((e) => {
            if (e.id !== id) return e;
            const next: MbEnvironment = {
              ...e,
              ...patch,
              ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
              ...(patch.target !== undefined ? { target: normalise(patch.target) } : {}),
            };
            /* An emptied note is a removed note, not an empty one: the form always
               sends the field, and a stored '' painted a captionless warning. */
            if (next.note !== undefined && next.note.trim() === '') delete next.note;
            return next;
          }),
        }),

      offered: [],

      seed: (list, reach) => {
        if (list.length === 0) return false;
        const fresh = adoptable(get().list, list, get().offered, reach);
        /*
         * A row this host published before is kept in step with what it publishes now.
         *
         * Otherwise a browser that adopted `/mb/local` from an older version would keep
         * showing that route for ever, while every new one shows the instance's address
         * — one instance described two ways depending on when somebody first ran this.
         * Only the spelling moves: if the row resolves to a DIFFERENT instance somebody
         * edited it deliberately, and that is theirs to keep.
         */
        const same = reach ?? normalise;
        const published = new Map(list.map((env) => [env.id, env]));
        const kept = get().list.map((env) => {
          const now = published.get(env.id);
          if (now === undefined) return env;
          if (same(env.target) !== same(now.target)) return env;
          if (normalise(env.target) === normalise(now.target)) return env;
          return { ...env, target: normalise(now.target) };
        });
        set({
          list: [...kept, ...fresh],
          /* Every offered id is remembered, including one skipped for duplicating an
             environment already here: the question must not be asked twice either way. */
          offered: [...new Set([...get().offered, ...list.map((env) => env.id)])],
        });
        return fresh.length > 0;
      },

      remove: (id) => set({ list: get().list.filter((e) => e.id !== id) }),

      markForwarded: (id) =>
        set({
          list: get().list.map((e) => (e.id === id ? { ...e, forwarded: true } : e)),
        }),
    }),
    { name: 'mountebank-studio-environments' },
  ),
);

/** The list, readable from outside React. */
export const environments = (): MbEnvironment[] => useEnvironments.getState().list;

/** One environment, or undefined when the id is not one of ours. */
export const findEnvironment = (id: string | undefined): MbEnvironment | undefined =>
  useEnvironments.getState().list.find((e) => e.id === id);

/**
 * The environment for an id, or an honest placeholder when the id is not one of
 * ours — a stale bookmark, or a record the user just removed. It carries no target,
 * so every read fails and says why, which is safer than either crashing or
 * pretending the connection exists.
 */
export const envOr = (id: string | undefined): MbEnvironment =>
  findEnvironment(id) ?? {
    id: id ?? 'unknown',
    label: id ?? 'Unknown environment',
    target: '',
    note: 'This environment is not defined in this browser. Add it in Settings.',
  };
