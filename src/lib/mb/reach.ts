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

import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

import { useEnvironments } from '../../store/useEnvironments';
import { useStudio } from '../../store/useStudio';
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
  /**
   * Whether the host serving this page will forward somewhere new if asked, and why not
   * when it will not. undefined until asked; a plain static deployment answers nothing
   * and is recorded as disabled.
   */
  forwarding: { enabled: boolean; reason?: string } | undefined;
  loadForwarding: () => Promise<void>;
  /**
   * Ask this host to forward to `url` as well. Returns the path it will be reached on,
   * or null when the host said no.
   *
   * The manifest is updated on success, which is all `resolveTarget` needs: the
   * environment keeps its address and the route changes underneath it.
   */
  askForward: (url: string) => Promise<string | null>;
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
/** Whether that layer takes requests, and where to send them. */
const FORWARDING_URL = '/mb/forwarding';
const TARGETS_URL = '/mb/targets';

export const useReach = create<ReachState>()((set, get) => ({
  map: {},
  manifest: undefined,
  forwarding: undefined,

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

  loadForwarding: async () => {
    if (get().forwarding !== undefined) return;
    set({ forwarding: { enabled: false } });
    try {
      const response = await fetch(FORWARDING_URL, { cache: 'no-store' });
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null) return;
      const { enabled, reason } = body as { enabled?: unknown; reason?: unknown };
      if (enabled === true) set({ forwarding: { enabled: true } });
      else if (typeof reason === 'string') set({ forwarding: { enabled: false, reason } });
    } catch {
      /* Served by something that has never heard of this. Disabled, as set above. */
    }
  },

  askForward: async (url) => {
    try {
      const response = await fetch(TARGETS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        cache: 'no-store',
      });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      const { name, route } = body as { name?: unknown; route?: unknown };
      if (typeof name !== 'string' || typeof route !== 'string') return null;
      set((s) => ({ manifest: { ...(s.manifest ?? {}), [name]: url } }));
      return route;
    } catch {
      return null;
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

/** The names for this machine. From a browser they all arrive at the same place. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Same instance? Compared without a trailing slash, without case in the host, and with
 * the loopback names treated as one.
 *
 * `http://localhost:2525` and `http://127.0.0.1:2525` are one Mountebank, and code that
 * says otherwise offers somebody a second row for the instance they already have, or
 * asks for a forward that exists. Which one somebody typed is not a fact about anything.
 */
function sameInstance(a: string, b: string): boolean {
  const key = (raw: string): string => {
    const trimmed = raw.trim().replace(/\/+$/, '');
    try {
      const url = new URL(trimmed);
      const host = url.hostname.toLowerCase();
      const machine = LOOPBACK.has(host) ? 'localhost' : host;
      const port = url.port === '' ? '' : `:${url.port}`;
      return `${url.protocol}//${machine}${port}${url.pathname.replace(/\/+$/, '')}`;
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
  const forwarding = useReach((s) => s.forwarding);
  const loadForwarding = useReach((s) => s.loadForwarding);

  useEffect(() => {
    if (opaque) probe(target);
  }, [opaque, target, probe, error]);

  /* Whether this host takes requests decides what the blocked case should even say. */
  useEffect(() => {
    if (opaque) void loadForwarding();
  }, [opaque, loadForwarding]);

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
    /*
     * Up, and refusing this page. Whether that is worth explaining at length depends on
     * whether anything can be done from here: a host that will forward turns this into a
     * button, and a paragraph about a flag on somebody else's instance becomes the
     * footnote rather than the answer.
     */
    if (forwarding?.enabled === true) {
      return {
        blocked: true,
        command: `mb start --origin "${origin}"`,
        text:
          `That address answered, but not to this page: the instance was not started with an ` +
          `--origin that allows ${origin}, so the browser throws the reply away. Nothing about ` +
          `that instance has to change, though — the host serving this panel can fetch it and ` +
          `pass it on, which is not a cross-origin request at all.`,
      };
    }

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

export interface ForwardOffer {
  /** Whether asking would help and is possible at all. */
  available: boolean;
  busy: boolean;
  /** Ask, remember the answer, and read again. */
  arrange: () => Promise<void>;
}

/**
 * Targets this session has already asked about, so several screens reporting one failure
 * do not each fire a request — and a refusal is not retried in a loop.
 */
const asked = new Set<string>();

/**
 * "Have this host forward to it."
 *
 * The offer that turns an unfixable error into one click. A blocked instance is up and
 * refuses this page, and `--origin` belongs to whoever runs it — which may be nobody in
 * this room. But the server that serves this panel can fetch it perfectly well, and a
 * request that leaves from this origin is not cross-origin at all.
 *
 * Nothing about the environment's address changes: it still records where the instance
 * is, and `resolveTarget` works the route out from the host's manifest, which this adds
 * to. The decision is remembered on the environment so it survives the host restarting
 * and forgetting.
 */
export function useForwardOffer(target: string, auto = false): ForwardOffer {
  const forwarding = useReach((s) => s.forwarding);
  const loadForwarding = useReach((s) => s.loadForwarding);
  const askForward = useReach((s) => s.askForward);
  const manifest = useReach((s) => s.manifest);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadForwarding();
  }, [loadForwarding]);

  const routed =
    manifest !== undefined &&
    manifest !== null &&
    Object.values(manifest).some((upstream) => sameInstance(upstream, target));

  const available =
    target !== '' && !isProxied(target) && !routed && forwarding?.enabled === true && !busy;

  const arrange = async (): Promise<void> => {
    setBusy(true);
    const route = await askForward(target);
    setBusy(false);

    const { toast } = useStudio.getState();
    if (route === null) {
      toast('This host would not forward to that address', 'warn');
      return;
    }

    const { list, markForwarded } = useEnvironments.getState();
    for (const env of list) {
      if (sameInstance(env.target, target)) markForwarded(env.id);
    }
    toast('Reaching it through this panel\u2019s host from now on');
    await queryClient.invalidateQueries();
  };

  /* Held in a ref so keeping it current does not re-run the effect below. */
  const arrangeRef = useRef(arrange);
  arrangeRef.current = arrange;

  /*
   * With `auto`, the panel does not wait to be told. The user pointed an environment at
   * that instance, which is the whole of the intent involved; making them read a
   * paragraph and press a link to get what they already asked for is ceremony. The toast
   * in `arrange` says what happened, and Settings reports the route from then on.
   *
   * Once per target per session: `asked` is shared, so the several screens that report
   * one failure make one request between them, and a host that says no is not asked
   * again on every render.
   */
  useEffect(() => {
    if (!auto || !available || asked.has(target)) return;
    asked.add(target);
    void arrangeRef.current();
  }, [auto, available, target]);

  return { available, busy, arrange };
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

/**
 * Re-ask for the forwards the user arranged in an earlier session.
 *
 * The host keeps them in memory, so `npx mountebank-studio` forgets every one on restart
 * while the browser still remembers which environments were reached that way. Asking
 * again here is what makes the arrangement outlive the process, without a file on disk
 * that nobody would ever think to look at.
 *
 * Runs after the manifest has loaded, so anything the host already publishes costs
 * nothing, and never rejects: a host that has stopped forwarding leaves the environment
 * failing as it would have anyway, with the offer available again.
 */
export async function restoreForwards(targets: string[]): Promise<void> {
  if (targets.length === 0) return;
  const { loadForwarding, askForward } = useReach.getState();
  await loadForwarding();
  if (useReach.getState().forwarding?.enabled !== true) return;

  for (const target of targets) {
    const { manifest } = useReach.getState();
    const known =
      manifest !== undefined &&
      manifest !== null &&
      Object.values(manifest).some((upstream) => sameInstance(upstream, target));
    if (known || target === '' || isProxied(target)) continue;
    await askForward(target);
  }
}
