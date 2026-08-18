/**
 * Telling a refused origin apart from a dead host.
 *
 * When a cross-origin request fails, a browser hands the script one opaque error
 * for two completely different situations: the host never answered, or it
 * answered and the browser threw the answer away because this page was not on its
 * allowlist. The status, the headers and the body are all withheld — by design,
 * so a page cannot use failures to probe a network it has no business reading.
 *
 * One extra request settles it. `mode: 'no-cors'` asks the browser to perform the
 * request and NOT to enforce the allowlist on the reply; the page gets back an
 * opaque response it cannot read, but the promise resolves. So:
 *
 *     resolves → something is there, it just will not answer this page  → --origin
 *     rejects  → nothing answered at all                                → URL / not running
 *
 * The verdict is kept per target and shared, because several screens report the
 * same failure at once and none of them should each fire their own probe. It also
 * expires: an instance that was reachable a minute ago may be down now, and a
 * cached "it is there" would then be a confident lie.
 */

import axios from 'axios';
import { useEffect } from 'react';
import { create } from 'zustand';

import { isProxied } from '../environments';

export type Reach = 'unknown' | 'checking' | 'answered' | 'silent';

/** How long a verdict may be reused before it has to be earned again. */
const FRESH_MS = 20_000;
const PROBE_TIMEOUT_MS = 6_000;

interface Verdict {
  reach: Reach;
  /** When it was decided. Absent while checking. */
  at?: number;
}

interface ReachState {
  map: Record<string, Verdict>;
  /** Probe `target` unless a fresh verdict already exists or one is in flight. */
  probe: (target: string) => void;
  /**
   * What this origin forwards, as the forwarding layer itself reports it:
   * `{ name: upstreamUrl }`. undefined until asked, null when there is no manifest
   * — which is the normal case for a plain static deployment.
   */
  manifest: Record<string, string> | null | undefined;
  loadManifest: () => void;
  /** Awaitable, for the one load that happens before the app renders. */
  ready: () => Promise<void>;
}

/**
 * One no-cors probe, awaited. Used by the environment form, which is testing a
 * URL that has no verdict cached yet because it may not even be saved.
 */
export async function respondsAtAll(target: string): Promise<boolean> {
  try {
    await fetch(`${target}/config`, { mode: 'no-cors', cache: 'no-store' });
    return true;
  } catch {
    return false;
  }
}

/** Where the forwarding layer publishes its map. Same origin, so always readable. */
const MANIFEST_URL = '/mb/targets.json';

export const useReach = create<ReachState>()((set, get) => ({
  map: {},
  manifest: undefined,

  loadManifest: () => {
    void get().ready();
  },

  ready: async () => {
    if (get().manifest !== undefined) return;
    /* Claim it before the request so two callers cannot both ask. */
    set({ manifest: null });

    try {
      const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!response.ok) return;
      /* A host without a manifest answers this with index.html under the SPA
         fallback, so a parse failure is the normal "there is none" path. */
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return;
      const clean: Record<string, string> = {};
      for (const [name, url] of Object.entries(body as Record<string, unknown>)) {
        if (typeof url === 'string' && url !== '' && name !== '') clean[name] = url;
      }
      if (Object.keys(clean).length > 0) set({ manifest: clean });
    } catch {
      /* No manifest. The slot already says so, and every target is called directly. */
    }
  },

  probe: (target) => {
    if (target === '') return;
    const held = get().map[target];
    if (held?.reach === 'checking') return;
    if (held?.at !== undefined && Date.now() - held.at < FRESH_MS) return;

    set((s) => ({ map: { ...s.map, [target]: { reach: 'checking' } } }));

    const settle = (reach: Reach): void => {
      set((s) => ({ map: { ...s.map, [target]: { reach, at: Date.now() } } }));
    };

    const timer = setTimeout(() => settle('silent'), PROBE_TIMEOUT_MS);

    void respondsAtAll(target).then((answered) => {
      clearTimeout(timer);
      settle(answered ? 'answered' : 'silent');
    });
  },
}));

/** Same instance? Compared without a trailing slash and without case in the host. */
function sameInstance(a: string, b: string): boolean {
  const key = (raw: string): string => {
    const trimmed = raw.trim().replace(/\/+$/, '');
    try {
      const url = new URL(trimmed);
      return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      return trimmed.toLowerCase();
    }
  };
  return key(a) === key(b) && key(a) !== '';
}

/**
 * True when the browser refused to say what went wrong. A response — any status,
 * even 401 or 500 — is not opaque: it arrived, so it can be reported as it is. A
 * timeout is not opaque either; it named its own cause.
 */
export function isOpaque(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (error.response !== undefined) return false;
  return error.code !== 'ECONNABORTED';
}

export interface Cause {
  /** What to say instead of the three-way guess. */
  text: string;
  /** The command that fixes it, when that is what is wrong. */
  command?: string;
  /** Whether the instance is up and only permission is missing. */
  blocked: boolean;
}

/**
 * The definite cause of an opaque failure, or null when the error already says
 * what happened and should be shown as it is.
 *
 * Calling this is what starts the probe, so a screen adopts it by rendering its
 * result — there is nothing else to wire up.
 */
export function useCause(target: string, error: unknown): Cause | null {
  const opaque = isOpaque(error);
  const probe = useReach((s) => s.probe);
  const verdict = useReach((s) => s.map[target]?.reach) ?? 'unknown';

  useEffect(() => {
    if (opaque) probe(target);
  }, [opaque, target, probe, error]);

  if (!opaque) return null;

  const origin = window.location.origin;

  /*
   * A target on this origin cannot fail for permission — there is no cross-origin
   * request to refuse. So the fault is the hop in front of this page: the location
   * that should forward to the instance, or the instance behind it. Offering
   * `--origin` here would send someone to change a flag that is not involved.
   */
  if (isProxied(target)) {
    return {
      blocked: false,
      text:
        `Nothing came back through ${target}. That path is served by whatever serves this page, ` +
        `so either it is not forwarding to a Mountebank admin API, or the instance behind it is ` +
        `down. Check the proxy rule for ${target} first.`,
    };
  }

  if (verdict === 'answered') {
    return {
      blocked: true,
      command: `mb start --origin "${origin}"`,
      text:
        `That address answered, but not to this page: the instance was not started with an ` +
        `--origin that allows ${origin}, so the browser discards the reply before the panel sees ` +
        `it. This host does not forward to that instance either — if it did, the panel would ` +
        `already be using that route instead of asking anything of the instance.`,
    };
  }

  if (verdict === 'silent') {
    return {
      blocked: false,
      text:
        `Nothing answered at that address. This is the URL or the instance rather than ` +
        `permission: check that it is running and that the host and port are right — the admin ` +
        `port is usually 2525.`,
    };
  }

  return { blocked: false, text: 'Working out whether that is the address or a permission…' };
}

/**
 * The path this origin forwards to THAT EXACT instance on, or null.
 *
 * Matched against the manifest by upstream URL, so the answer is a fact about the
 * deployment rather than a guess from a name. An environment whose id has drifted
 * from its target — the id is minted once and never changes — therefore cannot be
 * offered somebody else's instance.
 *
 * Pass a target only when it is worth asking (a blocked read); the hook does the
 * rest, once per session.
 */
export function useForwardedPath(target: string | undefined): string | null {
  const loadManifest = useReach((s) => s.loadManifest);
  const manifest = useReach((s) => s.manifest);

  useEffect(() => {
    if (target !== undefined) loadManifest();
  }, [target, loadManifest]);

  if (target === undefined || manifest === undefined || manifest === null) return null;

  const hit = Object.entries(manifest).find(([, upstream]) => sameInstance(upstream, target));
  return hit === undefined ? null : `/mb/${hit[0]}`;
}

/**
 * How the panel will actually reach a target.
 *
 * An environment records WHERE an instance is; this decides HOW to get there, and
 * that is a fact about the deployment rather than anything the user should have to
 * choose. If this origin forwards to that exact instance, the request goes through
 * the forwarding path — nothing is cross-origin, so no instance needs a flag. If it
 * does not, the URL is called directly, as before.
 *
 * Callable outside React: client.ts builds its axios instances here.
 */
export function resolveTarget(target: string): string {
  const trimmed = target.trim().replace(/\/+$/, '');
  if (trimmed === '' || isProxied(trimmed)) return trimmed;

  const { manifest } = useReach.getState();
  if (manifest === undefined || manifest === null) return trimmed;

  const hit = Object.entries(manifest).find(([, upstream]) => sameInstance(upstream, trimmed));
  return hit === undefined ? trimmed : `/mb/${hit[0]}`;
}

/** Whether reaching this target goes through this origin rather than to its host. */
export const isForwarded = (target: string): boolean => isProxied(resolveTarget(target));

/** The one load that must finish before the first request is built. */
export const readyToRoute = (): Promise<void> => useReach.getState().ready();
