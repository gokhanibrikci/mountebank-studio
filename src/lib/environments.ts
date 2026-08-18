/**
 * Environments are runtime data, not build-time constants.
 *
 * Mountebank Studio is a shell: it has no idea which service you are mocking, and
 * whoever installs it must be able to point it at their own instances without
 * editing source or rebuilding. So an environment is a record the user creates in
 * Settings, kept in this browser (see src/store/useEnvironments.ts).
 *
 * A target can be written two ways, and the difference is the whole story of how
 * the panel reaches an instance:
 *
 *   https://mb.example.com   DIRECT. The browser calls that host from this page,
 *                            which is cross-origin, so THAT INSTANCE has to allow
 *                            this origin: `mb start --origin "<this page>"`.
 *                            Right for an instance you start yourself.
 *
 *   /mb/stage                THROUGH THIS ORIGIN. The panel calls its own host,
 *                            which forwards to the instance (an nginx `location`,
 *                            or the dev server's proxy). Nothing is cross-origin,
 *                            so CORS never applies and the instance needs no flag
 *                            at all — nobody has to touch how it was installed.
 *                            Right for an instance somebody else deployed.
 *
 * Note that CORS is a browser rule and not access control either way: anything
 * that can reach the host over the network can still call the API. Use `--apikey`
 * and network rules for that.
 */

export type EnvId = string;

/**
 * An environment is three things and no more: what it is called, where it is, and
 * an optional note. It once also carried a colour and a read-only switch; both are
 * gone. The colour only tinted a dot, and the switch was a seatbelt the same
 * person could unbuckle in the next screen — neither earned a field in the form.
 */
export interface MbEnvironment {
  /** URL-safe, unique. It is the first segment of every route. */
  id: EnvId;
  label: string;
  /**
   * Where the admin API is, as an absolute URL (`https://mb.example.com`) for a
   * direct call, or as a path on this origin (`/mb/stage`) when something in front
   * of this page forwards to it. See the note at the top of this file.
   */
  target: string;
  /** Optional caution shown next to the environment. */
  note?: string;
}

/**
 * True when the target is a path on this very origin, so the request never leaves
 * it. `//host` is NOT one — that is protocol-relative and cross-origin.
 */
export const isProxied = (target: string): boolean =>
  target.startsWith('/') && !target.startsWith('//');

/** A label turned into something that can sit in a URL. */
export function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return slug === '' ? 'env' : slug;
}

/** Keeps a generated id unique against the ones already in use. */
export function uniqueId(base: string, taken: string[]): EnvId {
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export interface FieldErrors {
  label?: string;
  target?: string;
}

/**
 * What is wrong with a draft, field by field, so the form can say it in place.
 * An empty object means the draft is savable.
 */
export function validate(
  draft: { label: string; target: string },
  others: MbEnvironment[],
): FieldErrors {
  const errors: FieldErrors = {};

  if (draft.label.trim() === '') errors.label = 'Give it a name.';

  const target = normalise(draft.target);
  if (target === '') {
    errors.target = 'Where is the Mountebank admin API?';
  } else if (isProxied(target)) {
    /* A path is reached through this origin, so there is nothing to parse and
       nothing to allow — but it does have to be a path and not a bare slash. */
    if (target === '/') {
      errors.target = 'Give the path this page forwards to that instance on, e.g. /mb/stage';
    } else if (others.some((e) => normalise(e.target) === target)) {
      errors.target = 'Another environment already points at this instance.';
    }
  } else {
    let url: URL | null = null;
    try {
      url = new URL(target);
    } catch {
      url = null;
    }
    if (url === null) {
      errors.target = 'That is not a URL. Include the scheme, e.g. https://mb.example.com';
    } else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      errors.target = 'Only http and https can be reached from a browser.';
    } else if (others.some((e) => normalise(e.target) === normalise(target))) {
      errors.target = 'Another environment already points at this instance.';
    }
  }

  return errors;
}

/** Trailing slashes are noise; comparing without them avoids duplicate entries. */
export const normalise = (target: string): string => target.trim().replace(/\/+$/, '');

/**
 * Seed environments for a fresh install, read from VITE_ENVIRONMENTS so a team can
 * pre-provision without touching source. Anything malformed is ignored rather
 * than crashing the app on boot — a bad env var must not lock anyone out.
 */
export function seedFromEnv(raw: string | undefined): MbEnvironment[] {
  if (raw === undefined || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: MbEnvironment[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const row = item as Record<string, unknown>;
      const label = typeof row.label === 'string' ? row.label : '';
      const target = typeof row.target === 'string' ? row.target : '';
      if (Object.keys(validate({ label, target }, out)).length > 0) continue;
      const id = typeof row.id === 'string' && row.id !== '' ? slugify(row.id) : slugify(label);
      out.push({
        id: uniqueId(
          id,
          out.map((e) => e.id),
        ),
        label: label.trim(),
        target: normalise(target),
        ...(typeof row.note === 'string' && row.note !== '' ? { note: row.note } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}
