/**
 * Imposters and their stubs, as a Postman collection.
 *
 * A stub says what a request must look like for it to answer. Read the other way round,
 * that is a request — which is exactly what somebody wants when they have mocks running
 * and need something to fire at them. So each imposter becomes a folder, each stub a
 * request, and the port it answers on becomes the URL.
 *
 * THE TRANSLATION IS LOSSY, AND SAYS SO. A predicate is a condition; a request is one
 * concrete example that satisfies it. `startsWith` gives a prefix rather than a path,
 * `not` and `or` describe requests that must NOT arrive or one of several that might, and
 * `exists` names a field without a value. None of that survives as a request, so every
 * item's description records what was dropped. Better a request that works with a note
 * than a request that quietly does not match the stub it came from.
 *
 * Nothing here touches the network or the DOM: it takes the model and returns an object,
 * so the awkward parts are unit-testable and are tested.
 */

import { findMatchingStub } from './mb/match';
import type { Imposter, MbRecordedRequest, Pred, Resp, Stub } from './mb/types';

/** Only the parts of the schema this writes. Postman ignores what it does not know. */
export interface PostmanCollection {
  info: { name: string; description: string; schema: string };
  variable: Array<{ key: string; value: string }>;
  item: PostmanFolder[];
}

export interface PostmanFolder {
  name: string;
  description: string;
  item: PostmanItem[];
}

export interface PostmanItem {
  name: string;
  request: {
    method: string;
    header: Array<{ key: string; value: string }>;
    url: {
      raw: string;
      protocol: string;
      host: string[];
      port: string;
      path: string[];
      query: Array<{ key: string; value: string }>;
    };
    description: string;
    body?: { mode: 'raw'; raw: string; options: { raw: { language: string } } };
  };
}

const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
/** The host is a variable so one collection works against localhost and a shared box. */
const HOST_VAR = 'host';

/** What a stub's predicates describe, as far as a request can express it. */
interface Derived {
  method: string;
  path: string;
  query: Array<{ key: string; value: string }>;
  headers: Array<{ key: string; value: string }>;
  body: string | null;
  /** Everything the translation could not carry. */
  notes: string[];
}

/** Operators whose value can be used as-is; the rest are noted instead. */
const USABLE = new Set(['equals', 'deepEquals', 'startsWith', 'matches', 'contains', 'endsWith']);

function walk(preds: Pred[], into: Derived, negated = false): void {
  for (const pred of preds) {
    if (pred.kind === 'group') {
      if (pred.joiner === 'and') {
        walk(pred.preds, into, negated);
      } else if (pred.joiner === 'or') {
        /* One branch is a request; the others are different requests. Take the first and
           say so, rather than merging branches into something matching neither. */
        into.notes.push('This stub accepts any of several shapes (or) — the first is used here.');
        walk(pred.preds.slice(0, 1), into, negated);
      } else {
        into.notes.push('A not(…) condition cannot be expressed as a request, so it is ignored.');
      }
      continue;
    }

    if (pred.kind === 'raw') {
      into.notes.push('A predicate written as raw JSON was not translated.');
      continue;
    }

    if (pred.selector !== '') {
      into.notes.push(`A ${pred.op} on a jsonpath selector (${pred.selector}) was not translated.`);
      continue;
    }

    if (!USABLE.has(pred.op)) {
      into.notes.push(`A ${pred.op} condition names a field without a usable value.`);
      continue;
    }

    const approximate = pred.op !== 'equals' && pred.op !== 'deepEquals';

    for (const c of pred.conditions) {
      if (c.field === 'method' && c.value !== '') {
        into.method = c.value.toUpperCase();
      } else if (c.field === 'path' && c.value !== '') {
        into.path = c.value;
        if (approximate) {
          into.notes.push(`The path is a ${pred.op} condition, so this is one path that fits it.`);
        }
      } else if (c.field === 'query' && c.key !== '') {
        into.query.push({ key: c.key, value: c.value });
      } else if (c.field === 'headers' && c.key !== '') {
        into.headers.push({ key: c.key, value: c.value });
      } else if (c.field === 'body' && c.value !== '') {
        into.body = c.value;
        if (approximate) {
          into.notes.push(`The body is a ${pred.op} condition, so this is one body that fits it.`);
        }
      }
    }
  }
}

/** One line saying what the stub answers, so the request explains itself in Postman. */
function answers(responses: Resp[]): string {
  const first = responses[0];
  if (first === undefined)
    return 'This stub has no response, so Mountebank answers with its default.';

  const one = ((): string => {
    switch (first.type) {
      case 'proxy':
        return `Proxies to ${first.proxy.to || '(nowhere set)'} and records what it says.`;
      case 'inject':
        return 'Answers with injected JavaScript.';
      case 'fault':
        return `Breaks the connection (${first.fault}) instead of answering.`;
      default: {
        const status = first.is.statusCode === '' ? 'no status' : first.is.statusCode;
        const body = first.is.body.trim();
        const preview =
          body === '' ? 'an empty body' : `${body.slice(0, 60)}${body.length > 60 ? '…' : ''}`;
        return `Answers ${status} with ${preview}`;
      }
    }
  })();

  return responses.length > 1 ? `${one} Cycles through ${responses.length} responses.` : one;
}

/**
 * The request as Mountebank will see it, so the panel can answer the question that
 * actually matters: which stub ANSWERS this?
 */
function asRequest(derived: Derived): MbRecordedRequest {
  return {
    method: derived.method,
    path: derived.path,
    query: Object.fromEntries(derived.query.map((q) => [q.key, q.value])),
    headers: Object.fromEntries(derived.headers.map((h) => [h.key, h.value])),
    ...(derived.body === null ? {} : { body: derived.body }),
  };
}

function describe(derived: Derived, stubs: Stub[], index: number): string {
  const stub = stubs[index];
  const lines = [
    `Stub ${index + 1} of this imposter. ${stub === undefined ? '' : answers(stub.responses)}`.trim(),
  ];

  /*
   * Satisfying a stub's conditions is not the same as being answered by it. Mountebank
   * takes the FIRST stub that fits, so a broad stub above this one answers this request
   * instead — and the reply then looks nothing like the stub the request came from. That
   * is confusing enough to be worth a line: found while firing an exported collection at
   * a real imposter, where a POST written from stub 2 came back with stub 1's 404.
   */
  const answered = findMatchingStub(asRequest(derived), stubs);
  if (answered !== null && answered !== index) {
    derived.notes.push(
      `Stub ${answered + 1} also fits this request and, being higher in the list, is the one that ` +
        `answers it. Narrow that stub, or move this one above it, to reach this stub.`,
    );
  }

  if (derived.notes.length > 0) {
    lines.push('', 'Worth knowing:', ...[...new Set(derived.notes)].map((n) => `• ${n}`));
  }
  return lines.join('\n');
}

function itemFor(imposter: Imposter, index: number): PostmanItem {
  const stub = imposter.stubs[index];
  const derived: Derived = {
    method: 'GET',
    path: '/',
    query: [],
    headers: [],
    body: null,
    notes: [],
  };
  if (stub !== undefined) walk(stub.predicates, derived);

  const path = derived.path.startsWith('/') ? derived.path : `/${derived.path}`;
  const segments = path.split('/').filter((s) => s !== '');
  const search =
    derived.query.length === 0
      ? ''
      : `?${derived.query.map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`).join('&')}`;

  const body = derived.body;
  const looksJson = body !== null && /^\s*[[{]/.test(body);

  return {
    name: `${derived.method} ${path}`,
    request: {
      method: derived.method,
      header: derived.headers,
      url: {
        raw: `${imposter.protocol}://{{${HOST_VAR}}}:${imposter.port}${path}${search}`,
        protocol: imposter.protocol,
        host: [`{{${HOST_VAR}}}`],
        port: String(imposter.port),
        path: segments,
        query: derived.query,
      },
      description: describe(derived, imposter.stubs, index),
      ...(body === null
        ? {}
        : {
            body: {
              mode: 'raw' as const,
              raw: body,
              options: { raw: { language: looksJson ? 'json' : 'text' } },
            },
          }),
    },
  };
}

export interface PostmanExport {
  collection: PostmanCollection;
  /** Imposters left out, with the reason — reported rather than silently dropped. */
  skipped: Array<{ name: string; port: number; why: string }>;
}

/**
 * The collection, and what did not fit in it.
 *
 * Only http and https imposters become folders: a tcp or smtp imposter has no URL for
 * Postman to send to, and inventing one would produce requests that cannot work.
 */
export function toPostmanCollection(label: string, imposters: Imposter[]): PostmanExport {
  const skipped: PostmanExport['skipped'] = [];
  const item: PostmanFolder[] = [];

  for (const imposter of imposters) {
    if (imposter.protocol !== 'http' && imposter.protocol !== 'https') {
      skipped.push({
        name: imposter.name,
        port: imposter.port,
        why: `${imposter.protocol} has no URL Postman can send to`,
      });
      continue;
    }

    item.push({
      name: `${imposter.name || `port ${imposter.port}`} · ${imposter.port}`,
      description: [
        `Imposter on port ${imposter.port} (${imposter.protocol}).`,
        imposter.stubs.length === 0
          ? 'It has no stubs, so every request gets its default response.'
          : `${imposter.stubs.length} stub${imposter.stubs.length === 1 ? '' : 's'}, matched top to bottom: the first whose conditions fit answers.`,
      ].join(' '),
      item: imposter.stubs.map((_stub, index) => itemFor(imposter, index)),
    });
  }

  return {
    collection: {
      info: {
        name: `${label} · Mountebank mocks`,
        description: [
          `Generated by Mountebank Studio from the imposters running on ${label}.`,
          '',
          `The {{${HOST_VAR}}} variable is where those imposters answer — localhost by default.`,
          'Change it once here to point every request at another machine.',
          '',
          'Each request is ONE example that satisfies its stub. A stub is a condition and a',
          'request is an instance of it, so where the two cannot be the same thing — a',
          'startsWith path, a not(…), an or — the request says so in its own description.',
        ].join('\n'),
        schema: SCHEMA,
      },
      variable: [{ key: HOST_VAR, value: 'localhost' }],
      item,
    },
    skipped,
  };
}
