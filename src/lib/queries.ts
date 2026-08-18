/**
 * The data layer: TanStack Query on top of client.ts.
 *
 * Three rules this file exists to enforce:
 *
 *  1. EVERY key is namespaced by environment. Switching from dev to staging
 *     swaps a whole cache rather than mixing two mountebanks together, so a
 *     port number can never be read from one instance and written to another.
 *
 *  2. Wire → UI mapping happens inside `queryFn`, never in `select`. The model
 *     factories mint fresh ids (`uid`), so mapping on every render would hand
 *     the editor a new identity for the same stub on each paint and destroy
 *     focus and open/closed state. Mapping once per fetch keeps ids stable.
 *
 *  3. Every mutation is built by one helper, so its invalidation and its two
 *     toasts — the one on success and the one on failure — cannot drift apart
 *     between the writes.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { type EnvId } from '../lib/environments';
import {
  addStub,
  clearRequests,
  createImposter,
  deleteImposter,
  deleteStub,
  describeError,
  getConfig,
  getImposter,
  listImposters,
  replaceImposter,
  replaceStubs,
  updateStub,
} from './mb/client';
import { findMatchingStub } from './mb/match';
import { imposterFromMb, pretty } from './mb/model';
import type { Imposter, MbConfig, MbRecordedRequest, RecordedRequest, Stub } from './mb/types';
import { useStudio, type Toast } from '../store/useStudio';

/* ─────────────────────────────────  keys  ──────────────────────────────── */

export const mbKeys = {
  /** Everything for one environment — the prefix a full reload invalidates. */
  env: (env: EnvId): QueryKey => ['mb', env],
  imposters: (env: EnvId): QueryKey => ['mb', env, 'imposters'],
  imposter: (env: EnvId, port: number): QueryKey => ['mb', env, 'imposter', port],
  config: (env: EnvId): QueryKey => ['mb', env, 'config'],
};

/* ────────────────────────────────  reads  ──────────────────────────────── */

/**
 * `GET /config` — the live instance's version and flags. Injection support and
 * the `debug` flag are read from here, and neither changes while the panel is
 * open, so this is cached long.
 */
export function useConfig(env: EnvId): UseQueryResult<MbConfig, Error> {
  return useQuery({
    queryKey: mbKeys.config(env),
    queryFn: () => getConfig(env),
    staleTime: 5 * 60_000,
  });
}

/** Every imposter, already in the editable model. */
export function useImposters(env: EnvId): UseQueryResult<Imposter[], Error> {
  return useQuery({
    queryKey: mbKeys.imposters(env),
    queryFn: async () => (await listImposters(env)).map(imposterFromMb),
    staleTime: 5_000,
  });
}

export interface ImposterDetail {
  imposter: Imposter;
  /** Source order, which is chronological — views sort as they need to. */
  requests: RecordedRequest[];
}

/** A body is always held as text so a non-JSON payload survives untouched. */
const bodyText = (body: unknown): string => {
  if (body === undefined || body === null) return '';
  return typeof body === 'string' ? body : pretty(body);
};

/**
 * An absent or unparseable timestamp becomes 0 rather than "now": pretending a
 * request just arrived would be worse than sorting it to the bottom.
 */
function epochMs(timestamp: string | undefined): number {
  if (!timestamp) return 0;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * One imposter plus its recorded traffic.
 *
 * `matchedStubIndex` is COMPUTED here, not reported by mountebank — it only
 * reports the matching stub when started with `--debug`, and neither dev nor
 * staging is. Views must label it as computed.
 */
export function useImposter(env: EnvId, port: number): UseQueryResult<ImposterDetail, Error> {
  return useQuery({
    queryKey: mbKeys.imposter(env, port),
    enabled: Number.isFinite(port) && port > 0,
    staleTime: 2_000,
    queryFn: async (): Promise<ImposterDetail> => {
      const raw = await getImposter(env, port);
      const imposter = imposterFromMb(raw);
      const recorded: MbRecordedRequest[] = raw.requests ?? [];

      const requests = recorded.map((r, index): RecordedRequest => ({
        // requests are append-only, so index + arrival time is a stable identity
        id: `req_${port}_${index}_${r.timestamp ?? 'na'}`,
        method: (r.method ?? '').toUpperCase(),
        path: r.path ?? '',
        query: r.query ?? {},
        headers: r.headers ?? {},
        body: bodyText(r.body),
        timestamp: epochMs(r.timestamp),
        matchedStubIndex: findMatchingStub(r, imposter.stubs),
      }));

      return { imposter, requests };
    },
  });
}

/* ────────────────────────────────  writes  ─────────────────────────────── */

interface WriteSpec<TVars, TData> {
  /** The actual call. */
  run: (vars: TVars) => Promise<TData>;
  /** The sentence shown on success. */
  success: (vars: TVars) => string;
  /** Keys to invalidate afterwards. */
  keys: (vars: TVars) => QueryKey[];
  /** Destructive writes announce themselves in 'warn'. */
  tone?: Toast['tone'];
}

/**
 * Every mutation in this file is built here, so the invalidation and the two
 * toasts cannot drift apart between them.
 */
function useWrite<TVars, TData>(
  spec: WriteSpec<TVars, TData>,
): UseMutationResult<TData, Error, TVars> {
  const queryClient = useQueryClient();
  const toast = useStudio((s) => s.toast);

  return useMutation<TData, Error, TVars>({
    mutationFn: (vars) => spec.run(vars),
    onSuccess: (_data, vars) => {
      for (const key of spec.keys(vars)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      toast(spec.success(vars), spec.tone ?? 'ok');
    },
    onError: (error) => toast(describeError(error), 'err'),
  });
}

/* ──────────────────────────────  imposters  ────────────────────────────── */

export function useCreateImposter(env: EnvId) {
  return useWrite<Imposter, unknown>({
    run: (imposter) => createImposter(env, imposter),
    success: (imposter) => `${imposter.name} is running on port ${imposter.port}`,
    keys: (imposter) => [mbKeys.imposters(env), mbKeys.imposter(env, imposter.port)],
  });
}

export interface DeleteImposterVars {
  port: number;
  /** Used only in the toast; the port is the identity. */
  name?: string;
}

export function useDeleteImposter(env: EnvId) {
  return useWrite<DeleteImposterVars, void>({
    run: ({ port }) => deleteImposter(env, port),
    success: ({ port, name }) => `${name ?? `Imposter ${port}`} deleted`,
    keys: ({ port }) => [mbKeys.imposters(env), mbKeys.imposter(env, port)],
    tone: 'warn',
  });
}

/** Delete-then-create: mountebank has no PUT for one imposter. */
export function useReplaceImposter(env: EnvId) {
  return useWrite<Imposter, unknown>({
    run: (imposter) => replaceImposter(env, imposter),
    success: (imposter) => `${imposter.name} updated`,
    keys: (imposter) => [mbKeys.imposters(env), mbKeys.imposter(env, imposter.port)],
  });
}

/* ────────────────────────────────  stubs  ──────────────────────────────── */

export interface SaveStubVars {
  port: number;
  /** null appends a new stub; a number replaces the stub at that index. */
  index: number | null;
  stub: Stub;
  /** Used only in the toast for a newly added stub. */
  imposterName?: string;
}

export function useSaveStub(env: EnvId) {
  return useWrite<SaveStubVars, unknown>({
    run: ({ port, index, stub }) =>
      index === null ? addStub(env, port, stub) : updateStub(env, port, index, stub),
    success: ({ index, port, imposterName }) =>
      index === null ? `Stub added to ${imposterName ?? `port ${port}`}` : 'Stub saved',
    keys: ({ port }) => [mbKeys.imposters(env), mbKeys.imposter(env, port)],
  });
}

export interface StubIndexVars {
  port: number;
  index: number;
}

export function useDeleteStub(env: EnvId) {
  return useWrite<StubIndexVars, unknown>({
    run: ({ port, index }) => deleteStub(env, port, index),
    success: () => 'Stub deleted',
    keys: ({ port }) => [mbKeys.imposters(env), mbKeys.imposter(env, port)],
    tone: 'warn',
  });
}

export interface ReorderStubsVars {
  port: number;
  /** The complete list in its new order — mountebank has no move operation. */
  stubs: Stub[];
}

export function useReorderStubs(env: EnvId) {
  return useWrite<ReorderStubsVars, unknown>({
    run: ({ port, stubs }) => replaceStubs(env, port, stubs),
    success: () => 'Stub order saved',
    keys: ({ port }) => [mbKeys.imposters(env), mbKeys.imposter(env, port)],
  });
}

/* ──────────────────────────────  maintenance  ──────────────────────────── */

export interface ClearRequestsVars {
  port: number;
  /** Used only in the toast. */
  name?: string;
}

export function useClearRequests(env: EnvId) {
  return useWrite<ClearRequestsVars, void>({
    run: ({ port }) => clearRequests(env, port),
    success: ({ port, name }) => `Request log cleared for ${name ?? `port ${port}`}`,
    // numberOfRequests shows in the list too, so both keys go stale
    keys: ({ port }) => [mbKeys.imposters(env), mbKeys.imposter(env, port)],
    tone: 'warn',
  });
}
