/**
 * The lossy half of the translation is the half worth testing.
 *
 * A predicate is a condition and a request is one instance of it, so the interesting
 * cases are the ones where those cannot be the same thing: a prefix instead of a path, a
 * negation, a choice between branches, a field named without a value. Each must produce a
 * request that works AND a description saying what was left behind — a request that
 * silently fails to match the stub it came from would be worse than no request.
 */

import { describe, expect, it } from 'vitest';

import { toPostmanCollection } from './postman';
import type { Condition, Imposter, Pred, Resp, Stub } from './mb/types';

let seq = 0;
const id = (): string => `x${++seq}`;

const cond = (
  field: Condition['field'],
  value: string,
  key = '',
  type: Condition['type'] = 'string',
): Condition => ({ field, key, value, type });

const simple = (op: string, conditions: Condition[], selector = ''): Pred => ({
  kind: 'simple',
  id: id(),
  op: op as Pred extends { op: infer O } ? O : never,
  conditions,
  selector,
  caseSensitive: true,
});

const group = (joiner: 'and' | 'or' | 'not', preds: Pred[]): Pred => ({
  kind: 'group',
  id: id(),
  joiner,
  preds,
});

const is = (statusCode: number | string, body = ''): Resp => ({
  id: id(),
  type: 'is',
  is: { statusCode, headers: {}, body, extras: {} },
  proxy: {
    to: '',
    mode: 'proxyOnce',
    genMethod: false,
    genPath: false,
    genQuery: false,
    genBody: false,
    addWait: false,
    decorate: '',
    generators: [],
    extras: {},
  },
  inject: '',
  fault: 'CONNECTION_RESET_BY_PEER',
  behaviors: [],
  extraBehaviors: [],
  repeat: 1,
  extras: {},
});

const stub = (predicates: Pred[], responses: Resp[] = [is(200, '{"ok":true}')]): Stub => ({
  id: id(),
  predicates,
  responses,
});

const imposter = (over: Partial<Imposter> = {}): Imposter => ({
  port: 4545,
  name: 'orders',
  protocol: 'http',
  recordRequests: true,
  defaultResponse: '',
  key: '',
  cert: '',
  mutualAuth: false,
  stubs: [],
  numberOfRequests: 0,
  extras: {},
  ...over,
});

const only = (imp: Imposter) => {
  const out = toPostmanCollection('development', [imp]);
  const folder = out.collection.item[0];
  if (folder === undefined) throw new Error('no folder');
  return { folder, request: folder.item[0]?.request, name: folder.item[0]?.name, out };
};

describe('toPostmanCollection', () => {
  it('turns a plain stub into the request it describes', () => {
    const { request, name } = only(
      imposter({
        stubs: [
          stub([
            simple('equals', [cond('method', 'POST'), cond('path', '/v1/cards')]),
            simple('equals', [cond('query', 'fibabanka', 'bank')]),
            simple('equals', [cond('headers', 'application/json', 'Content-Type')]),
          ]),
        ],
      }),
    );
    expect(name).toBe('POST /v1/cards');
    expect(request?.method).toBe('POST');
    expect(request?.url.raw).toBe('http://{{host}}:4545/v1/cards?bank=fibabanka');
    expect(request?.url.path).toEqual(['v1', 'cards']);
    expect(request?.url.query).toEqual([{ key: 'bank', value: 'fibabanka' }]);
    expect(request?.header).toEqual([{ key: 'Content-Type', value: 'application/json' }]);
  });

  it('defaults to GET / when the stub says nothing about either', () => {
    const { request, name } = only(imposter({ stubs: [stub([])] }));
    expect(name).toBe('GET /');
    expect(request?.url.raw).toBe('http://{{host}}:4545/');
  });

  it('says so when a path is a prefix rather than a path', () => {
    const { request } = only(
      imposter({ stubs: [stub([simple('startsWith', [cond('path', '/v1/')])])] }),
    );
    expect(request?.url.raw).toBe('http://{{host}}:4545/v1/');
    expect(request?.description).toContain('startsWith');
    expect(request?.description).toContain('Worth knowing');
  });

  it('flattens an and group', () => {
    const { request } = only(
      imposter({
        stubs: [
          stub([
            group('and', [
              simple('equals', [cond('method', 'PUT')]),
              simple('equals', [cond('path', '/v1/limits')]),
            ]),
          ]),
        ],
      }),
    );
    expect(request?.method).toBe('PUT');
    expect(request?.url.path).toEqual(['v1', 'limits']);
    expect(request?.description).not.toContain('Worth knowing');
  });

  it('takes the first branch of an or, and admits it', () => {
    const { request } = only(
      imposter({
        stubs: [
          stub([
            group('or', [
              simple('equals', [cond('path', '/first')]),
              simple('equals', [cond('path', '/second')]),
            ]),
          ]),
        ],
      }),
    );
    expect(request?.url.path).toEqual(['first']);
    expect(request?.description).toContain('any of several shapes');
  });

  it('ignores a not group rather than inverting it', () => {
    /* The reported stub: a path prefix, and NOT a pair of query values. The request must
       still be one that reaches the imposter — inverting the negation would produce a
       request the stub deliberately excludes. */
    const { request } = only(
      imposter({
        stubs: [
          stub([
            simple('startsWith', [cond('path', '/v1/')]),
            group('not', [
              group('and', [
                simple('equals', [cond('query', 'fibabanka', 'bank')]),
                simple('equals', [cond('query', 'FIBACARD', 'product')]),
              ]),
            ]),
          ]),
        ],
      }),
    );
    expect(request?.url.raw).toBe('http://{{host}}:4545/v1/');
    expect(request?.url.query).toEqual([]);
    expect(request?.description).toContain('not(…)');
  });

  it('notes an operator that carries no value', () => {
    const { request } = only(
      imposter({ stubs: [stub([simple('exists', [cond('headers', 'true', 'Authorization')])])] }),
    );
    expect(request?.header).toEqual([]);
    expect(request?.description).toContain('exists');
  });

  it('notes a jsonpath selector instead of comparing against the whole body', () => {
    const { request } = only(
      imposter({ stubs: [stub([simple('equals', [cond('body', '42')], '$.amount')])] }),
    );
    expect(request?.body).toBeUndefined();
    expect(request?.description).toContain('jsonpath');
  });

  it('carries a body, and labels JSON as JSON', () => {
    const { request } = only(
      imposter({ stubs: [stub([simple('equals', [cond('body', '{"amount":1}')])])] }),
    );
    expect(request?.body?.raw).toBe('{"amount":1}');
    expect(request?.body?.options.raw.language).toBe('json');
  });

  it('reports what each stub answers', () => {
    const { folder } = only(
      imposter({
        stubs: [
          stub([], [is(503, 'nope'), is(200, 'ok')]),
          stub([], [{ ...is(200), type: 'fault' }]),
        ],
      }),
    );
    expect(folder.item[0]?.request.description).toContain('Answers 503');
    expect(folder.item[0]?.request.description).toContain('Cycles through 2');
    expect(folder.item[1]?.request.description).toContain('Breaks the connection');
  });

  it('says when an earlier stub is the one that will actually answer', () => {
    /*
     * Found by firing an exported collection at a real imposter: the request written from
     * stub 2 came back with stub 1's 404, because stub 1 fits it too and Mountebank takes
     * the first that fits. The request is right; what was missing was saying so.
     */
    const { folder } = only(
      imposter({
        stubs: [
          stub([simple('startsWith', [cond('path', '/v1/')])], [is(404, 'unknown')]),
          stub(
            [simple('equals', [cond('method', 'POST'), cond('path', '/v1/cards')])],
            [is(201, '{"id":"c-1"}')],
          ),
        ],
      }),
    );
    expect(folder.item[1]?.request.description).toContain('Stub 1 also fits this request');
    /* And the one on top is reached, so it is told nothing of the sort. */
    expect(folder.item[0]?.request.description).not.toContain('also fits this request');
  });

  it('stays quiet when each stub is the one reached', () => {
    const { folder } = only(
      imposter({
        stubs: [
          stub([simple('equals', [cond('path', '/a')])]),
          stub([simple('equals', [cond('path', '/b')])]),
        ],
      }),
    );
    for (const item of folder.item) {
      expect(item.request.description).not.toContain('also fits this request');
    }
  });

  it('leaves out an imposter Postman could not send to, and says which', () => {
    const out = toPostmanCollection('development', [
      imposter({ protocol: 'tcp', port: 4546, name: 'ledger' }),
      imposter(),
    ]);
    expect(out.collection.item.map((f) => f.name)).toEqual(['orders · 4545']);
    expect(out.skipped).toEqual([
      { name: 'ledger', port: 4546, why: 'tcp has no URL Postman can send to' },
    ]);
  });

  it('carries the host as a variable so one collection follows the instance', () => {
    const out = toPostmanCollection('staging', [imposter({ protocol: 'https', port: 8443 })]);
    expect(out.collection.variable).toEqual([{ key: 'host', value: 'localhost' }]);
    expect(out.collection.item[0]?.item).toEqual([]);
    expect(out.collection.info.name).toBe('staging · Mountebank mocks');
  });
});
