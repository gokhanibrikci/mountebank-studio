/**
 * The Mountebank admin API, called straight from the browser.
 *
 * The target comes from the environment record the user created, so nothing here
 * is compiled in. HOW that target is reached is decided by `resolveTarget`: through
 * this origin when the host that serves this page forwards to that same instance,
 * and otherwise by calling its URL directly — which, being cross-origin, needs
 * `mb start --origin "<this origin>"` on the instance. A browser cannot read a
 * response it blocked for CORS, so `describeError` names that case explicitly
 * instead of reporting an unhelpful "failed to fetch".
 *
 * Two rules this file exists to enforce:
 *  1. Never follow `_links` from a response — mountebank emits http:// hrefs even
 *     behind a TLS terminator, which a browser blocks as mixed content. URLs are
 *     always built from the environment's own target.
 *  2. Never send back read-only fields (`_links`, `numberOfRequests`, `requests`).
 *     `imposterToMb` is the only writer, so that stays true by construction.
 */

import axios, { type AxiosInstance } from 'axios';

import type { EnvId } from '../environments';
import { findEnvironment } from '../../store/useEnvironments';
import { DEMO_BUILD, demoClient, isDemoTarget } from '../demo/instance';
import { imposterToMb, stubToMb } from './model';
import { resolveTarget } from './reach';
import type { Imposter, MbConfig, MbImposter, MbStub, Stub } from './types';

/** Keyed by id AND route, so editing an instance's URL retires the old client. */
const clients = new Map<string, AxiosInstance>();

export class UnknownEnvironmentError extends Error {
  constructor(env: EnvId) {
    super(`No environment called "${env}" is defined in this browser.`);
    this.name = 'UnknownEnvironmentError';
  }
}

function http(env: EnvId): AxiosInstance {
  const environment = findEnvironment(env);
  if (environment === undefined) throw new UnknownEnvironmentError(env);

  const base = resolveTarget(environment.target);
  const key = `${env}|${base}`;
  let client = clients.get(key);
  if (!client) {
    /*
     * The demo answers from this tab. It is swapped in HERE, at the transport, so every
     * screen, query and failure path above stays the code that talks to a real instance —
     * if the demo behaves differently from the product, the demo is the thing that is
     * wrong.
     */
    if (DEMO_BUILD && isDemoTarget(environment.target)) {
      client = demoClient();
      clients.set(key, client);
      return client;
    }
    client = axios.create({
      baseURL: base,
      timeout: 20_000,
      headers: { 'Content-Type': 'application/json' },
    });
    clients.set(key, client);
  }
  return client;
}

/** Turns any transport failure into a message worth showing a developer. */
export function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as
      { message?: string; errors?: Array<{ message?: string }> } | undefined;
    const fromBody = body?.message ?? body?.errors?.[0]?.message;
    if (fromBody) return fromBody;
    if (error.response) return `${error.response.status} ${error.response.statusText}`;
    if (error.code === 'ECONNABORTED') return 'The request timed out.';
    /*
     * No response at all. The browser refuses to tell a script whether it was a
     * CORS refusal, a dead host or a bad name, so the message has to cover the
     * likely causes in the order they actually happen.
     */
    return (
      'No answer from the instance. Either it is not running, the URL is wrong, or it ' +
      'was not started with --origin allowing this page.'
    );
  }
  return error instanceof Error ? error.message : String(error);
}

/* ────────────────────────────────  reads  ──────────────────────────────── */

export const getConfig = async (env: EnvId): Promise<MbConfig> =>
  (await http(env).get<MbConfig>('/config')).data;

/**
 * Neither list view is complete, and mountebank offers no third one:
 *   • the default view carries `numberOfRequests` but NO stubs
 *   • `replayable=true` carries the stubs but NO `numberOfRequests`
 * Asking for one and trusting it makes either the stub count or the request
 * count read zero on every row, so we ask for both and merge them by port.
 */
export async function listImposters(env: EnvId): Promise<MbImposter[]> {
  const [summary, replayable] = await Promise.all([
    http(env).get<{ imposters: MbImposter[] }>('/imposters'),
    http(env).get<{ imposters: MbImposter[] }>('/imposters', { params: { replayable: true } }),
  ]);

  const counts = new Map<number, number>(
    (summary.data.imposters ?? []).map((i) => [i.port, i.numberOfRequests ?? 0]),
  );

  return (replayable.data.imposters ?? []).map((i) => ({
    ...i,
    numberOfRequests: counts.get(i.port) ?? 0,
  }));
}

export const getImposter = async (env: EnvId, port: number): Promise<MbImposter> =>
  (await http(env).get<MbImposter>(`/imposters/${port}`)).data;

/* ────────────────────────────────  writes  ─────────────────────────────── */

export const createImposter = async (env: EnvId, imposter: Imposter): Promise<MbImposter> =>
  (await http(env).post<MbImposter>('/imposters', imposterToMb(imposter))).data;

export const deleteImposter = async (env: EnvId, port: number): Promise<void> => {
  await http(env).delete(`/imposters/${port}`);
};

/**
 * Mountebank has no PUT for a single imposter, so an edit is delete-then-create.
 * The port is the identity, so this is how the admin API is meant to be used.
 */
export async function replaceImposter(env: EnvId, imposter: Imposter): Promise<MbImposter> {
  await deleteImposter(env, imposter.port);
  return createImposter(env, imposter);
}

/** Replaces every imposter at once — the "save the whole config" operation. */
export const replaceAll = async (env: EnvId, imposters: Imposter[]): Promise<MbImposter[]> =>
  (
    await http(env).put<{ imposters: MbImposter[] }>('/imposters', {
      imposters: imposters.map(imposterToMb),
    })
  ).data.imposters ?? [];

/* ─────────────────────────────  stub sub-resource  ─────────────────────── */

export const addStub = async (
  env: EnvId,
  port: number,
  stub: Stub,
  index?: number,
): Promise<MbImposter> => {
  const payload: { stub: MbStub; index?: number } = { stub: stubToMb(stub) };
  if (index !== undefined) payload.index = index;
  return (await http(env).post<MbImposter>(`/imposters/${port}/stubs`, payload)).data;
};

export const updateStub = async (
  env: EnvId,
  port: number,
  index: number,
  stub: Stub,
): Promise<MbImposter> =>
  (await http(env).put<MbImposter>(`/imposters/${port}/stubs/${index}`, { stub: stubToMb(stub) }))
    .data;

export const deleteStub = async (env: EnvId, port: number, index: number): Promise<MbImposter> =>
  (await http(env).delete<MbImposter>(`/imposters/${port}/stubs/${index}`)).data;

/** Reorders by rewriting the whole list — mountebank has no move operation. */
export const replaceStubs = async (env: EnvId, port: number, stubs: Stub[]): Promise<MbImposter> =>
  (await http(env).put<MbImposter>(`/imposters/${port}/stubs`, { stubs: stubs.map(stubToMb) }))
    .data;

/* ───────────────────────────────  maintenance  ─────────────────────────── */

export const clearRequests = async (env: EnvId, port: number): Promise<void> => {
  await http(env).delete(`/imposters/${port}/savedRequests`);
};

export const clearProxyResponses = async (env: EnvId, port: number): Promise<void> => {
  await http(env).delete(`/imposters/${port}/savedProxyResponses`);
};
