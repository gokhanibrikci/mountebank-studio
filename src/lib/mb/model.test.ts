import { describe, expect, it } from 'vitest';

import ordersFixture from './__fixtures__/orders-imposters.json';
import billingFixture from './__fixtures__/billing-imposters.json';
import {
  guessType,
  imposterFromMb,
  imposterToMb,
  predFromMb,
  predToMb,
  respFromMb,
  respToMb,
  stubFromMb,
  stubToMb,
} from './model';
import type { MbImposter, MbPredicate, MbResponse, MbStub } from './types';

/**
 * Round-tripping is the contract the whole editor rests on: whatever the visual
 * editor shows must serialise back to byte-identical Mountebank JSON, or an edit
 * to one stub would silently rewrite a neighbouring one.
 *
 * The fixtures are hand-written but shaped exactly like what
 * `GET /imposters?replayable=true` returns, and between them they cover every
 * construct the editor claims to model: a predicate carrying several fields, a
 * `startsWith`, negated groups over query and headers, static JSON and text
 * responses, injected responses and a default response.
 */

const fixtures: Array<[string, { imposters: MbImposter[] }]> = [
  ['orders', ordersFixture as { imposters: MbImposter[] }],
  ['billing', billingFixture as { imposters: MbImposter[] }],
];

describe('round trip against replayable imposter payloads', () => {
  for (const [env, fixture] of fixtures) {
    describe(env, () => {
      const stubs = fixture.imposters.flatMap((imp) => imp.stubs ?? []);

      it('has stubs to check', () => {
        expect(stubs.length).toBeGreaterThan(0);
      });

      stubs.forEach((stub, index) => {
        it(`stub #${index} survives model → wire → model unchanged`, () => {
          // mountebank decorates reads with _links; we never send those back
          const strip = <T extends object>(o: T): T => {
            const {
              _links: _drop,
              _proxyResponseTime: _drop2,
              ...rest
            } = o as T & {
              _links?: unknown;
              _proxyResponseTime?: unknown;
            };
            return rest as T;
          };
          const clean: MbStub = {
            predicates: (stub.predicates ?? []).map(strip),
            responses: (stub.responses ?? []).map(strip),
          };
          expect(stubToMb(stubFromMb(clean))).toEqual(clean);
        });
      });
    });
  }
});

describe('predicate mapping', () => {
  const cases: Array<[string, MbPredicate]> = [
    ['equals on method', { equals: { method: 'POST' } }],
    ['equals on path', { equals: { path: '/v1/orders/summary' } }],
    ['startsWith on path', { startsWith: { path: '/v1/' } }],
    ['contains on body', { contains: { body: 'customerRef' } }],
    ['matches on path', { matches: { path: '^/v1/.*$' } }],
    ['exists on query', { exists: { query: { orderRef: true } } }],
    ['header equality', { equals: { headers: { 'X-Request-Id': 'abc' } } }],
    ['query equality', { equals: { query: { orderRef: 'ORD-1001' } } }],
    [
      'jsonpath selector as an operator sibling',
      {
        equals: { body: 'CUST-1024' },
        jsonpath: { selector: '$..customerRef' },
      },
    ],
    ['case sensitivity flag', { equals: { path: '/Case' }, caseSensitive: true }],
    ['numeric value keeps its type', { equals: { body: 42 } }],
    ['boolean value keeps its type', { equals: { body: true } }],
    ['or group', { or: [{ equals: { path: '/a' } }, { equals: { path: '/b' } }] }],
    ['and group', { and: [{ equals: { method: 'GET' } }, { startsWith: { path: '/v1' } }] }],
    ['not group', { not: { equals: { path: '/health' } } }],
    [
      'nested group',
      {
        or: [
          { equals: { path: '/a' } },
          { and: [{ equals: { method: 'POST' } }, { contains: { body: 'x' } }] },
        ],
      },
    ],
  ];

  for (const [name, wire] of cases) {
    it(name, () => {
      expect(predToMb(predFromMb(wire))).toEqual(wire);
    });
  }

  it('keeps an unmodelled predicate verbatim instead of dropping it', () => {
    const exotic = { inject: '(request) => request.path.length > 3' } as MbPredicate;
    const parsed = predFromMb(exotic);
    expect(parsed.kind).toBe('raw');
    expect(predToMb(parsed)).toEqual(exotic);
  });
});

describe('response mapping', () => {
  const cases: Array<[string, MbResponse]> = [
    [
      'static json body',
      {
        is: {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: { ok: true },
        },
      },
    ],
    ['static text body', { is: { statusCode: 200, body: 'Hello Mountebank' } }],
    ['error status', { is: { statusCode: 501, body: { success: false } } }],
    [
      'proxy once',
      {
        proxy: {
          to: 'https://orders.example.com',
          mode: 'proxyOnce',
          predicateGenerators: [{ matches: { method: true, path: true } }],
        },
      },
    ],
    [
      'proxy always with latency and decorate',
      {
        proxy: {
          to: 'https://example.test',
          mode: 'proxyAlways',
          predicateGenerators: [{ matches: { body: true } }],
          addWaitBehavior: true,
          addDecorateBehavior: '(req, res) => res',
        },
      },
    ],
    ['inject', { inject: 'function (request) { return { statusCode: 200 }; }' }],
    ['wait behavior', { is: { statusCode: 200, body: {} }, behaviors: [{ wait: 8000 }] }],
    ['repeat', { is: { statusCode: 401, body: {} }, repeat: 2 }],

    /* ---- constructs the editor does not draw, and must not destroy ---- */
    ['fault: connection reset', { fault: 'CONNECTION_RESET_BY_PEER' }],
    ['fault: garbage then close', { fault: 'RANDOM_DATA_THEN_CLOSE', repeat: 3 }],
    [
      'binary is response',
      { is: { statusCode: 200, body: 'AAECAwQ=', _mode: 'binary' } },
    ],
    ['tcp data response', { is: { data: 'OK\n' } }],
    [
      'proxy with injected headers and mutual auth',
      {
        proxy: {
          to: 'https://orders.example.com',
          mode: 'proxyOnce',
          predicateGenerators: [{ matches: { path: true } }],
          injectHeaders: { 'X-Trace': 'panel' },
          key: '--key--',
          cert: '--cert--',
          passphrase: 'secret',
        },
      },
    ],
    [
      'proxy generators the form cannot draw',
      {
        proxy: {
          to: 'https://orders.example.com',
          mode: 'proxyAlways',
          predicateGenerators: [
            {
              matches: { body: true },
              caseSensitive: true,
              except: '\\d+',
              jsonpath: { selector: '$..customerRef' },
              predicateOperator: 'contains',
            },
            { matches: { method: true }, ignore: { headers: ['Date'] } },
          ],
        },
      },
    ],
    [
      'an unknown behavior keeps its place in the list',
      {
        is: { statusCode: 200, body: {} },
        behaviors: [{ wait: 100 }, { someFutureBehavior: { of: 'a later mountebank' } }],
      },
    ],
  ];

  for (const [name, wire] of cases) {
    it(name, () => {
      expect(respToMb(respFromMb(wire))).toEqual(wire);
    });
  }
});

describe('minimal writes', () => {
  it('omits headers and body that were never set, so untouched stubs stay untouched', () => {
    const wire: MbResponse = { is: { statusCode: 204 } };
    expect(respToMb(respFromMb(wire))).toEqual(wire);
  });

  it('still sends an explicitly empty json body', () => {
    const wire: MbResponse = { is: { statusCode: 200, body: {} } };
    expect(respToMb(respFromMb(wire))).toEqual(wire);
  });
});

describe('imposter mapping', () => {
  it('preserves the fields mountebank accepts on POST /imposters', () => {
    const wire: MbImposter = {
      protocol: 'http',
      port: 4545,
      name: 'orders-service',
      recordRequests: true,
      defaultResponse: { statusCode: 501, headers: {}, body: { success: false } },
      stubs: [
        {
          predicates: [{ equals: { method: 'GET', path: '/demo' } }],
          responses: [{ is: { statusCode: 200, body: 'ok' } }],
        },
      ],
    };
    expect(imposterToMb(imposterFromMb(wire))).toEqual(wire);
  });

  it('emits TLS fields only for https', () => {
    const http = imposterFromMb({
      protocol: 'http',
      port: 1,
      key: 'k',
      cert: 'c',
      mutualAuth: true,
    });
    expect(imposterToMb(http).key).toBeUndefined();
    expect(imposterToMb(http).mutualAuth).toBeUndefined();

    const https = imposterFromMb({
      protocol: 'https',
      port: 2,
      key: 'k',
      cert: 'c',
      mutualAuth: true,
    });
    expect(imposterToMb(https)).toMatchObject({ key: 'k', cert: 'c', mutualAuth: true });
  });

  it('never sends a half-typed default response', () => {
    const imp = imposterFromMb({ protocol: 'http', port: 3 });
    imp.defaultResponse = '{ "statusCode": 50';
    expect(imposterToMb(imp).defaultResponse).toBeUndefined();
  });

  it('drops read-only fields mountebank rejects on write', () => {
    const wire = {
      protocol: 'http',
      port: 4,
      numberOfRequests: 16,
      _links: { self: { href: 'x' } },
    } as MbImposter;
    const out = imposterToMb(imposterFromMb(wire)) as unknown as Record<string, unknown>;
    expect(out.numberOfRequests).toBeUndefined();
    expect(out._links).toBeUndefined();
  });
});

describe('constructs this editor does not model', () => {
  it('reads a fault as a fault, not as a 200', () => {
    const resp = respFromMb({ fault: 'CONNECTION_RESET_BY_PEER' });
    expect(resp.type).toBe('fault');
    expect(resp.fault).toBe('CONNECTION_RESET_BY_PEER');
    /* The bug this replaces: a fault arrived, was read as `is`, and saving the
       stub turned a broken-connection mock into a successful 200. */
    expect(respToMb(resp).is).toBeUndefined();
  });

  it('keeps a tcp imposter\'s own fields through a write', () => {
    const wire: MbImposter = {
      protocol: 'tcp',
      port: 5555,
      name: 'ledger-tcp',
      mode: 'binary',
      endOfRequestResolver: { inject: '(data) => data.length > 4' },
      stubs: [],
    };
    const out = imposterToMb(imposterFromMb(wire));
    expect(out.mode).toBe('binary');
    expect(out.endOfRequestResolver).toEqual({ inject: '(data) => data.length > 4' });
  });

  it('still refuses to send back what mountebank rejects', () => {
    const wire: MbImposter = {
      protocol: 'http',
      port: 4545,
      name: 'orders',
      mode: 'text',
      numberOfRequests: 12,
      requests: [{ method: 'GET' }],
      _links: { self: { href: 'http://x' } },
      stubs: [],
    };
    const out = imposterToMb(imposterFromMb(wire));
    expect(out.mode).toBe('text');
    expect(out.numberOfRequests).toBeUndefined();
    expect(out.requests).toBeUndefined();
    expect(out._links).toBeUndefined();
  });
});

describe('value typing', () => {
  it('never retypes a value on its own — a digits-only reference stays a string', () => {
    const wire: MbPredicate = { equals: { body: '00123456789' } };
    expect(predToMb(predFromMb(wire))).toEqual(wire);
  });

  it('keeps a real number a number', () => {
    const wire: MbPredicate = { equals: { body: 42 } };
    expect(predToMb(predFromMb(wire))).toEqual(wire);
  });

  it('keeps a leading-zero string intact', () => {
    const wire: MbPredicate = { equals: { body: '0930' } };
    expect(predToMb(predFromMb(wire))).toEqual(wire);
  });

  it('keeps an object operand as an object', () => {
    const wire: MbPredicate = { deepEquals: { body: { channel: 'MOBILE', retry: 2 } } };
    expect(predToMb(predFromMb(wire))).toEqual(wire);
  });

  it('suggests a type for pasted text without applying it', () => {
    expect(guessType('42')).toBe('number');
    expect(guessType('0930')).toBe('string');
    expect(guessType('true')).toBe('boolean');
    expect(guessType('{"a":1}')).toBe('json');
    expect(guessType('/v1/path')).toBe('string');
  });
});
