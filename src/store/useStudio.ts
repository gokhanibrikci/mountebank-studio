import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { type EnvId } from '../lib/environments';

export type EditorView = 'visual' | 'json';

export interface Toast {
  id: string;
  message: string;
  tone: 'ok' | 'warn' | 'err';
}

interface StudioState {
  /**
   * Which environment the panel is pointed at, mirrored in the URL. Empty until
   * the user has defined one — there is no sensible default to invent, because
   * the list is theirs.
   */
  env: EnvId;
  setEnv: (env: EnvId) => void;

  /**
   * True while the welcome screen is being held open on purpose. Adding the first
   * environment makes the whole shell available at once, and without this the
   * panel would pull the page out from under someone who is still adding
   * instances — so the welcome stays until they press Start. Session-only: a
   * reload with an environment defined goes straight into the shell.
   */
  welcome: boolean;
  setWelcome: (welcome: boolean) => void;

  /** Visual ⇄ JSON toggle, remembered so it survives navigation. */
  editorView: EditorView;
  setEditorView: (view: EditorView) => void;

  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  toasts: Toast[];
  toast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: string) => void;
}

let toastSeq = 0;

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      env: '',
      setEnv: (env) => set({ env }),

      welcome: false,
      setWelcome: (welcome) => set({ welcome }),

      editorView: 'visual',
      setEditorView: (editorView) => set({ editorView }),

      paletteOpen: false,
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

      toasts: [],
      toast: (message, tone = 'ok') => {
        const id = `t${++toastSeq}`;
        set({ toasts: [...get().toasts, { id, message, tone }] });
        setTimeout(() => get().dismissToast(id), 3200);
      },
      dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    }),
    {
      name: 'mountebank-studio',
      // toasts and transient UI must not come back from storage
      partialize: (s) => ({ env: s.env, editorView: s.editorView }),
    },
  ),
);
