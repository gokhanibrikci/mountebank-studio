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
}

interface EnvironmentsState {
  list: MbEnvironment[];
  add: (draft: EnvironmentDraft) => MbEnvironment;
  update: (id: EnvId, patch: Partial<EnvironmentDraft>) => void;
  remove: (id: EnvId) => void;
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

      remove: (id) => set({ list: get().list.filter((e) => e.id !== id) }),
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
