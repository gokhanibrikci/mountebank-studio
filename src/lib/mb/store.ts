/**
 * The one file this host keeps its mocks in.
 *
 * `mountebank-studio` starts an instance and owns its persistence: everything it holds is
 * written to a single JSON document, and read back from it at startup. This is the panel's
 * side of that — where the file is, and moving it.
 *
 * It is a fact about the HOST, not about an environment. Only the instance this command
 * started is kept this way; an instance somebody else runs persists however they set it up,
 * and the endpoint says so rather than inventing a policy for it.
 *
 * Both calls are same-origin, so nothing here can fail for CORS. `/mb/store` simply does
 * not exist on a build served by anything else, and a 404 reads as "not this deployment".
 */

/** What the host says about the file. `kept: false` carries the reason instead. */
export type StoreState =
  | { kept: false; reason: string }
  | {
      kept: true;
      path: string;
      /** False until the first write — a first run has nothing to keep yet. */
      exists: boolean;
      bytes: number | null;
      /** Epoch ms of the last write this run, or null if nothing has changed yet. */
      savedAt: number | null;
      /** The last write that failed, so a broken path is visible rather than silent. */
      error: string | null;
      /** Where a relative path would land. */
      cwd: string;
    };

const URL_STORE = '/mb/store';

/** Null when this build is not served by a host that keeps one. */
export async function readStore(): Promise<StoreState | null> {
  try {
    const response = await fetch(URL_STORE, { cache: 'no-store' });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && 'kept' in body ? (body as StoreState) : null;
  } catch {
    return null;
  }
}

export interface MoveResult {
  state: StoreState | null;
  /** What the host refused, in its own words — it is the one that knows the filesystem. */
  error: string | null;
}

/**
 * "Keep it here from now on."
 *
 * The host writes the current mocks to the new path before it takes effect, so a move
 * cannot lose them, and refuses a path it will not write to — a directory, a file that is
 * not a configuration of ours — rather than clobbering it.
 */
export async function moveStore(path: string): Promise<MoveResult> {
  try {
    const response = await fetch(URL_STORE, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const errors =
        typeof body === 'object' && body !== null ? (body as { errors?: unknown }).errors : null;
      const first = Array.isArray(errors) ? (errors[0] as { message?: unknown }) : null;
      return {
        state: null,
        error:
          typeof first?.message === 'string'
            ? first.message
            : `The host refused that path (${response.status}).`,
      };
    }
    return { state: body as StoreState, error: null };
  } catch (error) {
    return {
      state: null,
      error: error instanceof Error ? error.message : 'The host could not be reached.',
    };
  }
}

/** A size somebody can read, from a number of bytes. */
export function fileSize(bytes: number | null): string {
  if (bytes === null) return 'not written yet';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
