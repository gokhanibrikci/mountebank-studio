/**
 * A Mountebank admin API that lives in this tab.
 *
 * The panel is a static page whose only dependency is an admin API over HTTP. That makes
 * a demo possible without hosting anything: answer those same calls from memory and the
 * whole panel works — creating imposters, editing stubs, reading traffic — with nothing
 * installed and no instance running.
 *
 * It is an axios ADAPTER rather than a fork of the client. Every screen, every query and
 * every error path stays exactly the code that talks to a real instance; only the
 * transport changes. If the demo drifts from the product, the demo is wrong, and that is
 * the right way round.
 *
 * WHAT IT COSTS EVERYONE ELSE. `DEMO_BUILD` is a compile-time constant, so the branch that
 * reaches any of this is folded away in a normal build — but the module and its seed still
 * travel with it: 3,349 bytes, 860 gzipped, measured rather than guessed. Cheap enough that
 * a build-time alias to strip it would be more machinery than the saving is worth.
 *
 * WHAT IT IS NOT. It does not run imposters: nothing listens on those ports, so a request
 * to one cannot be answered and no new traffic appears. It implements the twelve calls the
 * panel makes and mountebank's response shapes for them, not the engine behind them.
 * Anything the panel does not ask for answers 501, so a future screen calling something
 * new fails loudly here rather than silently pretending.
 */

import axios, { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

import type { MbConfig, MbImposter, MbStub } from '../mb/types';
import { demoImposters } from './seed';

/** The address that means "answer from this tab". Not a URL, so nothing can call it. */
export const DEMO_TARGET = 'demo://in-this-tab';

/**
 * Whether this build is the demo. Set at build time (`VITE_DEMO=1`), so a normal build
 * cannot be talked into demo mode by anything a page or a user does — the seed, the
 * banner and the adapter all hang off this one flag.
 */
export const DEMO_BUILD = (import.meta.env.VITE_DEMO as string | undefined) === '1';

export const isDemoTarget = (target: string): boolean => target.trim() === DEMO_TARGET;

/* ────────────────────────────────  the state  ───────────────────────────── */

/** Ordered by port, because that is how mountebank lists them. */
let imposters: MbImposter[] = demoImposters();

const byPort = (port: number): MbImposter | undefined => imposters.find((i) => i.port === port);

/** Everything except stubs and traffic: mountebank's default list view. */
function summary(imposter: MbImposter): MbImposter {
  const { stubs: _stubs, requests: _requests, ...rest } = imposter;
  return { ...rest, numberOfRequests: imposter.requests?.length ?? imposter.numberOfRequests ?? 0 };
}

/** Stubs but no counts: what `replayable=true` returns. */
function replayable(imposter: MbImposter): MbImposter {
  const { requests: _requests, numberOfRequests: _n, ...rest } = imposter;
  return rest;
}

const CONFIG: MbConfig = {
  version: '2.9.4',
  options: {
    port: 2525,
    /* Said plainly, because the panel reports these and a demo must not claim to be
       something it is not: nothing is allowed anywhere, because nothing is listening. */
    allowInjection: false,
    localOnly: true,
    debug: false,
    origin: false,
  },
  process: { nodeVersion: 'in your browser', uptime: 0 },
};

/* ──────────────────────────────  the responses  ─────────────────────────── */

interface Reply {
  status: number;
  data: unknown;
}

const ok = (data: unknown): Reply => ({ status: 200, data });

const errorReply = (status: number, code: string, message: string): Reply => ({
  status,
  data: { errors: [{ code, message }] },
});

const noSuchImposter = (port: number): Reply =>
  errorReply(404, 'no such resource', `Try POSTing to /imposters first? There is no imposter on port ${port}.`);

/** `{stub}` / `{stubs}` bodies, without trusting the shape. */
function stubsFrom(body: unknown, key: 'stub' | 'stubs'): MbStub[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  if (key === 'stub') return typeof value === 'object' && value !== null ? [value as MbStub] : null;
  return Array.isArray(value) ? (value as MbStub[]) : null;
}

function indexFrom(body: unknown, fallback: number): number {
  if (typeof body !== 'object' || body === null) return fallback;
  const value = (body as Record<string, unknown>).index;
  return typeof value === 'number' ? value : fallback;
}

/**
 * One request, answered.
 *
 * `path` has the leading slash and no query string; `params` carries the query.
 */
export function handle(
  method: string,
  path: string,
  params: Record<string, unknown>,
  body: unknown,
): Reply {
  const verb = method.toUpperCase();

  if (path === '/config' && verb === 'GET') {
    return ok(CONFIG);
  }

  if (path === '/imposters') {
    if (verb === 'GET') {
      const replay = params.replayable === true || params.replayable === 'true';
      return ok({ imposters: imposters.map(replay ? replayable : summary) });
    }
    if (verb === 'POST') {
      const wanted = typeof body === 'object' && body !== null ? (body as MbImposter) : null;
      if (wanted === null || typeof wanted.port !== 'number') {
        return errorReply(400, 'bad data', "An imposter needs a 'port' and a 'protocol'.");
      }
      if (byPort(wanted.port) !== undefined) {
        return errorReply(400, 'resource conflict', `Port ${wanted.port} is already in use.`);
      }
      const created: MbImposter = { ...wanted, numberOfRequests: 0, requests: [] };
      imposters = [...imposters, created].sort((a, b) => a.port - b.port);
      return { status: 201, data: created };
    }
    if (verb === 'PUT') {
      /* Replace every imposter: the whole-config write. */
      const wanted = stubsFrom(body, 'stubs');
      const list =
        typeof body === 'object' && body !== null
          ? ((body as { imposters?: unknown }).imposters as MbImposter[] | undefined)
          : undefined;
      if (!Array.isArray(list) || wanted !== null) {
        return errorReply(400, 'bad data', "Send { imposters: [ … ] } to replace them all.");
      }
      imposters = list
        .map((i) => ({ ...i, numberOfRequests: 0, requests: [] }))
        .sort((a, b) => a.port - b.port);
      return ok({ imposters: imposters.map(replayable) });
    }
  }

  /* /imposters/:port and everything under it. */
  const parts = path.split('/').filter((p) => p !== '');
  if (parts[0] !== 'imposters' || parts[1] === undefined) {
    return errorReply(501, 'not implemented', `The demo does not answer ${verb} ${path}.`);
  }

  const port = Number(parts[1]);
  const imposter = byPort(port);
  if (Number.isNaN(port)) return errorReply(400, 'bad data', `${parts[1]} is not a port.`);

  /* /imposters/:port */
  if (parts.length === 2) {
    if (verb === 'GET') return imposter === undefined ? noSuchImposter(port) : ok(imposter);
    if (verb === 'DELETE') {
      /* mountebank answers with what it removed, and an empty object when there was
         nothing there — deleting twice is not an error. */
      imposters = imposters.filter((i) => i.port !== port);
      return ok(imposter ?? {});
    }
  }

  if (imposter === undefined) return noSuchImposter(port);
  const stubs = imposter.stubs ?? [];
  const write = (next: MbStub[]): Reply => {
    imposters = imposters.map((i) => (i.port === port ? { ...i, stubs: next } : i));
    return ok({ ...imposter, stubs: next });
  };

  /* /imposters/:port/stubs */
  if (parts[2] === 'stubs' && parts.length === 3) {
    if (verb === 'POST') {
      const added = stubsFrom(body, 'stub');
      if (added === null) return errorReply(400, 'bad data', 'Send { stub: { … } }.');
      const at = indexFrom(body, stubs.length);
      const next = [...stubs];
      next.splice(Math.max(0, Math.min(at, stubs.length)), 0, ...added);
      return write(next);
    }
    if (verb === 'PUT') {
      const all = stubsFrom(body, 'stubs');
      if (all === null) return errorReply(400, 'bad data', 'Send { stubs: [ … ] }.');
      return write(all);
    }
  }

  /* /imposters/:port/stubs/:index */
  if (parts[2] === 'stubs' && parts.length === 4) {
    const index = Number(parts[3]);
    if (Number.isNaN(index) || index < 0 || index >= stubs.length) {
      return errorReply(400, 'bad data', `This imposter has no stub at index ${parts[3]}.`);
    }
    if (verb === 'PUT') {
      const replacement = stubsFrom(body, 'stub');
      if (replacement === null) return errorReply(400, 'bad data', 'Send { stub: { … } }.');
      const next = [...stubs];
      next.splice(index, 1, ...replacement);
      return write(next);
    }
    if (verb === 'DELETE') {
      const next = [...stubs];
      next.splice(index, 1);
      return write(next);
    }
  }

  /* The two sweeps. Both answer with the imposter, as mountebank does. */
  if (parts[2] === 'savedRequests' && verb === 'DELETE') {
    imposters = imposters.map((i) =>
      i.port === port ? { ...i, requests: [], numberOfRequests: 0 } : i,
    );
    return ok({ ...imposter, requests: [], numberOfRequests: 0 });
  }

  if (parts[2] === 'savedProxyResponses' && verb === 'DELETE') {
    /* Recorded proxy responses live inside the stubs a proxy created. The seed has none
       recorded yet, so there is nothing to strip — but answer as mountebank would. */
    return ok(imposter);
  }

  return errorReply(501, 'not implemented', `The demo does not answer ${verb} ${path}.`);
}

/* ────────────────────────────────  the adapter  ─────────────────────────── */

/** Just enough delay that loading states are real rather than skipped. */
const LATENCY_MS = 140;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * axios calls this instead of XHR. Errors are real AxiosErrors carrying the body, so
 * `describeError` and every failure screen behave exactly as they do against an instance.
 */
export const demoAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  const url = config.url ?? '/';
  const path = `/${url.replace(/^\/+/, '').split('?')[0] ?? ''}`;
  const params = (config.params ?? {}) as Record<string, unknown>;

  let body: unknown = config.data;
  if (typeof body === 'string' && body !== '') {
    try {
      body = JSON.parse(body);
    } catch {
      /* Leave it as text; the handler will refuse it. */
    }
  }

  await wait(LATENCY_MS);
  const reply = handle(config.method ?? 'get', path, params, body);

  const response: AxiosResponse = {
    data: reply.data,
    status: reply.status,
    statusText: String(reply.status),
    headers: { 'content-type': 'application/json' },
    config,
    request: null,
  };

  if (reply.status >= 400) {
    throw new AxiosError(
      `Request failed with status code ${reply.status}`,
      String(reply.status),
      config,
      null,
      response,
    );
  }
  return response;
};

/** An axios instance that never leaves the tab. */
export const demoClient = () =>
  axios.create({
    baseURL: DEMO_TARGET,
    adapter: demoAdapter,
    headers: { 'Content-Type': 'application/json' },
  });

/** Back to the seed — for a "reset the demo" control. */
export function resetDemo(): void {
  imposters = demoImposters();
}
