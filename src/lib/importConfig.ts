/**
 * Reading a file of imposters back in.
 *
 * The panel already writes this shape out — Settings → Full configuration is exactly what
 * `--configfile` expects — so the way in should accept the same document, and the two
 * obvious variants of it that people actually have on disk:
 *
 *     { "imposters": [ … ] }     what mountebank writes and reads
 *     [ … ]                      just the array, which is what most exports paste as
 *     { "port": 4545, … }        one imposter on its own
 *
 * NOTHING IS SENT UNTIL IT IS UNDERSTOOD. This parses, checks and reports first, so the
 * screen can say what will happen — which ports get created, which get replaced, what in
 * the file is unusable — before a single write leaves the browser. A bulk write that turns
 * out to be half a write is the worst outcome available here, and the only way to avoid it
 * is to refuse to start one blind.
 *
 * It validates what MOUNTEBANK requires and nothing more. A port may be absent: mountebank
 * assigns one, and rejecting that would be this panel inventing a rule the engine does not
 * have. Unknown fields are left alone for the same reason — a protocol this panel has never
 * heard of is the engine's business.
 */

import type { MbImposter } from './mb/types';

/** Which of the three documents this was. */
export type ImportShape = 'configfile' | 'array' | 'single';

export interface ImportProblem {
  /** Where it is, in words somebody can find in their file. */
  where: string;
  what: string;
}

export interface ParsedImport {
  shape: ImportShape | null;
  /** Everything usable, in the order the file had it. */
  imposters: MbImposter[];
  /** What was skipped, and why. Empty means the whole file was usable. */
  problems: ImportProblem[];
}

const PROTOCOLS = new Set(['http', 'https', 'tcp', 'smtp']);

/** Mountebank's own limits: a port is a port, and the protocol has to exist. */
function check(candidate: unknown, where: string): { imposter?: MbImposter; problem?: ImportProblem } {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return { problem: { where, what: 'not an object' } };
  }

  const row = candidate as Record<string, unknown>;

  if (typeof row.protocol !== 'string' || row.protocol === '') {
    return { problem: { where, what: 'no protocol — mountebank needs http, https, tcp or smtp' } };
  }
  if (!PROTOCOLS.has(row.protocol)) {
    /* Not refused: a custom protocol is loaded with --protofile and is none of our
       business. Reported, because a typo looks exactly like this. */
    return {
      imposter: row as unknown as MbImposter,
      problem: {
        where,
        what: `protocol "${row.protocol}" is not one of mountebank's four — kept, but check it is a --protofile protocol and not a typo`,
      },
    };
  }

  if (row.port !== undefined) {
    const port = row.port;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { problem: { where, what: `port ${JSON.stringify(port)} is not a whole number between 1 and 65535` } };
    }
  }

  if (row.stubs !== undefined && !Array.isArray(row.stubs)) {
    return { problem: { where, what: 'stubs is not a list' } };
  }

  return { imposter: row as unknown as MbImposter };
}

/**
 * A name for an imposter in a message: its own, then its port, then its place in the file —
 * because an imposter with neither still has to be referred to as something.
 */
export const describeImposter = (imposter: MbImposter, index: number): string => {
  const named = imposter.name !== undefined && imposter.name !== '';
  const port = typeof imposter.port === 'number' ? `port ${imposter.port}` : null;
  if (named && port !== null) return `${imposter.name} · ${port}`;
  if (named) return `${imposter.name} · mountebank will assign a port`;
  return port ?? `the ${index + 1}. imposter in the file · mountebank will assign a port`;
};

/**
 * Text in, imposters out — with a list of everything that was not usable.
 *
 * A parse failure is a problem like any other rather than an exception: the screen shows
 * problems next to the file, and a thrown error would be one more shape it has to handle.
 */
export function parseImposterJson(text: string): ParsedImport {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { shape: null, imposters: [], problems: [{ where: 'the file', what: 'is empty' }] };
  }

  let body: unknown;
  try {
    body = JSON.parse(trimmed);
  } catch (error) {
    return {
      shape: null,
      imposters: [],
      problems: [
        {
          where: 'the file',
          what: `is not JSON — ${error instanceof Error ? error.message : 'it could not be parsed'}`,
        },
      ],
    };
  }

  /* Which of the three documents is this? */
  let list: unknown[];
  let shape: ImportShape;
  if (Array.isArray(body)) {
    list = body;
    shape = 'array';
  } else if (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { imposters?: unknown }).imposters)
  ) {
    list = (body as { imposters: unknown[] }).imposters;
    shape = 'configfile';
  } else if (typeof body === 'object' && body !== null) {
    list = [body];
    shape = 'single';
  } else {
    return {
      shape: null,
      imposters: [],
      problems: [{ where: 'the file', what: 'is a bare value, not an imposter or a list of them' }],
    };
  }

  const imposters: MbImposter[] = [];
  const problems: ImportProblem[] = [];
  const seen = new Map<number, number>();

  list.forEach((candidate, index) => {
    const where = shape === 'single' ? 'the imposter' : `imposter ${index + 1} of ${list.length}`;
    const { imposter, problem } = check(candidate, where);
    if (problem !== undefined) problems.push(problem);
    if (imposter === undefined) return;

    /* Two imposters on one port cannot both exist, and mountebank would take the first
       and refuse the second halfway through the write. Say so now instead. */
    if (typeof imposter.port === 'number') {
      const first = seen.get(imposter.port);
      if (first !== undefined) {
        problems.push({
          where,
          what: `port ${imposter.port} is already used by imposter ${first} in this file — the later one is skipped`,
        });
        return;
      }
      seen.set(imposter.port, index + 1);
    }

    imposters.push(imposter);
  });

  return { shape, imposters, problems };
}

/** Which of these ports something is already listening on in this environment. */
export function portsInUse(parsed: MbImposter[], existing: MbImposter[]): number[] {
  const taken = new Set(existing.map((i) => i.port));
  return parsed
    .map((i) => i.port)
    .filter((port): port is number => typeof port === 'number' && taken.has(port));
}

/** How many stubs the file carries, for a sentence that says what is about to happen. */
export const countStubs = (imposters: MbImposter[]): number =>
  imposters.reduce((total, imposter) => total + (imposter.stubs?.length ?? 0), 0);
