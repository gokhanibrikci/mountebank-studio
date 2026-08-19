/**
 * What the demo starts with.
 *
 * Written for the demo rather than borrowed from the test fixtures: those exist to pin
 * down round-tripping and are shaped by the bugs they were written for. This is shaped
 * by what somebody meeting the panel for the first time should find — enough of
 * Mountebank to be worth looking at, and nothing that only makes sense to us.
 *
 * So: three imposters with a story between them, predicates from the plain kind to a
 * negated group, all four response kinds (canned, proxy, injected, fault), a behavior, a
 * response cycle, a tcp imposter to show the protocol is not always http, and traffic
 * already captured so the Activity screen has something in it.
 *
 * These are WIRE objects — exactly what `GET /imposters?replayable=true` returns — so
 * the demo instance can serve them without translating anything.
 */

import type { MbImposter } from '../mb/types';

/* A fixed clock: the demo must read the same on every visit, and "3 minutes ago" is
   worked out from the newest request rather than from the machine's date. */
const T = (secondsAgo: number): string =>
  new Date(Date.parse('2026-08-19T09:14:00.000Z') - secondsAgo * 1000).toISOString();

const ORDERS: MbImposter = {
  port: 4545,
  protocol: 'http',
  name: 'orders-service',
  recordRequests: true,
  numberOfRequests: 5,
  defaultResponse: {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json' },
    body: '{"error":"no stub matched this request"}',
  },
  stubs: [
    {
      /* The plain case: one method, one path. */
      predicates: [{ equals: { method: 'GET', path: '/v1/orders/1001' } }],
      responses: [
        {
          is: {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: '{"id":1001,"total":149.9,"currency":"TRY","status":"paid"}',
          },
        },
      ],
    },
    {
      /* A negated group, and a delay: the order exists but the service is slow. */
      predicates: [
        { startsWith: { path: '/v1/orders/' } },
        { not: { equals: { query: { include: 'lines' } } } },
      ],
      responses: [
        {
          is: {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: '{"id":1002,"total":38,"currency":"TRY","status":"pending"}',
          },
          _behaviors: { wait: 400 },
        },
      ],
    },
    {
      /* Two responses, cycled: the first call fails, the retry succeeds. Exactly the
         shape somebody reaches for when testing a retry, and hard to express anywhere
         else. */
      predicates: [{ equals: { method: 'POST', path: '/v1/orders' } }],
      responses: [
        { is: { statusCode: 503, body: '{"error":"try again"}' } },
        {
          is: {
            statusCode: 201,
            headers: { 'Content-Type': 'application/json', Location: '/v1/orders/1003' },
            body: '{"id":1003,"status":"created"}',
          },
        },
      ],
    },
    {
      /* A fault: the connection dies instead of answering. No status code exists for
         this, which is the point. */
      predicates: [{ equals: { path: '/v1/orders/timeout' } }],
      responses: [{ fault: 'CONNECTION_RESET_BY_PEER' }],
    },
    {
      /* Recording against the real service, kept once. */
      predicates: [{ startsWith: { path: '/v1/customers/' } }],
      responses: [
        {
          proxy: {
            to: 'https://api.internal.example.com',
            mode: 'proxyOnce',
            predicateGenerators: [{ matches: { method: true, path: true, query: true } }],
          },
        },
      ],
    },
  ],
  requests: [
    {
      requestFrom: '::ffff:127.0.0.1:54012',
      method: 'GET',
      path: '/v1/orders/1001',
      query: {},
      headers: { Host: 'localhost:4545', Accept: 'application/json' },
      body: '',
      timestamp: T(184),
    },
    {
      requestFrom: '::ffff:127.0.0.1:54018',
      method: 'POST',
      path: '/v1/orders',
      query: {},
      headers: { Host: 'localhost:4545', 'Content-Type': 'application/json' },
      body: '{"customer":88,"lines":[{"sku":"A-1","qty":2}]}',
      timestamp: T(151),
    },
    {
      requestFrom: '::ffff:127.0.0.1:54018',
      method: 'POST',
      path: '/v1/orders',
      query: {},
      headers: { Host: 'localhost:4545', 'Content-Type': 'application/json' },
      body: '{"customer":88,"lines":[{"sku":"A-1","qty":2}]}',
      timestamp: T(149),
    },
    {
      requestFrom: '::ffff:127.0.0.1:54031',
      method: 'GET',
      path: '/v1/orders/1002',
      query: { include: 'lines' },
      headers: { Host: 'localhost:4545', Accept: 'application/json' },
      body: '',
      timestamp: T(96),
    },
    {
      /* Nothing matches this one, so the default response answered it — which is what
         the Activity screen is for. */
      requestFrom: '::ffff:127.0.0.1:54044',
      method: 'DELETE',
      path: '/v1/baskets/9',
      query: {},
      headers: { Host: 'localhost:4545' },
      body: '',
      timestamp: T(41),
    },
  ],
};

const PAYMENTS: MbImposter = {
  port: 4546,
  protocol: 'http',
  name: 'payments-service',
  recordRequests: true,
  numberOfRequests: 2,
  stubs: [
    {
      predicates: [
        { equals: { method: 'POST', path: '/v1/payments' } },
        { equals: { headers: { 'Content-Type': 'application/json' } } },
      ],
      responses: [
        {
          is: {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: '{"reference":"PAY-77120","approved":true}',
          },
        },
      ],
    },
    {
      /* An injected response: the reply depends on the request. Only available on an
         instance started with --allowInjection, which this demo says it is not. */
      predicates: [{ equals: { path: '/v1/payments/echo' } }],
      responses: [
        {
          inject:
            "function (request) {\n  return { statusCode: 200, body: JSON.stringify({ sawBody: request.body }) };\n}",
        },
      ],
    },
  ],
  requests: [
    {
      requestFrom: '::ffff:127.0.0.1:54102',
      method: 'POST',
      path: '/v1/payments',
      query: {},
      headers: { Host: 'localhost:4546', 'Content-Type': 'application/json' },
      body: '{"orderId":1001,"amount":149.9}',
      timestamp: T(131),
    },
    {
      requestFrom: '::ffff:127.0.0.1:54109',
      method: 'POST',
      path: '/v1/payments',
      query: {},
      headers: { Host: 'localhost:4546', 'Content-Type': 'text/plain' },
      body: 'orderId=1002',
      timestamp: T(72),
    },
  ],
};

const LEDGER: MbImposter = {
  port: 4547,
  protocol: 'tcp',
  name: 'ledger-feed',
  recordRequests: false,
  numberOfRequests: 0,
  /* tcp has no status code and no path: a reply is `data`, and the panel carries that
     through untouched rather than inventing an http shape for it. */
  stubs: [
    {
      predicates: [{ contains: { data: 'POSTING' } }],
      responses: [{ is: { data: 'ACK|POSTING|OK\n' } }],
    },
  ],
  mode: 'text',
};

export const demoImposters = (): MbImposter[] =>
  /* A copy per call: the demo instance mutates what it is given. */
  JSON.parse(JSON.stringify([ORDERS, PAYMENTS, LEDGER])) as MbImposter[];

/** The newest timestamp in the seed, so "how long ago" can be relative to it. */
export const demoNow = (): string => T(0);
