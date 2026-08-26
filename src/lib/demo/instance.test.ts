/**
 * The demo has to answer exactly what the panel asks, in mountebank's shapes.
 *
 * This is the test that keeps the demo honest. Every screen goes through the same client,
 * so a wrong shape here shows up as a broken panel that only breaks on the demo — the
 * hardest kind of bug to notice, because the product itself is fine. The two list views
 * are the sharpest edge: mountebank's default view carries counts and no stubs, and
 * `replayable=true` carries stubs and no counts, and the panel merges them.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { handle, resetDemo } from './instance';
import type { MbImposter } from '../mb/types';

const get = (path: string, params: Record<string, unknown> = {}) =>
  handle('GET', path, params, undefined);

const list = (params: Record<string, unknown> = {}): MbImposter[] =>
  (get('/imposters', params).data as { imposters: MbImposter[] }).imposters;

const one = (port: number): MbImposter => get(`/imposters/${port}`).data as MbImposter;

describe('the demo instance', () => {
  beforeEach(() => resetDemo());

  it('reports a config the panel can read', () => {
    const reply = get('/config');
    expect(reply.status).toBe(200);
    expect((reply.data as { version: string }).version).toBe('2.9.4');
    /* Said plainly rather than flattered: nothing is listening, so nothing is allowed. */
    expect((reply.data as { options: { allowInjection: boolean } }).options.allowInjection).toBe(
      false,
    );
  });

  it('lists imposters with counts and no stubs, as the default view does', () => {
    const imposters = list();
    expect(imposters.map((i) => i.port)).toEqual([4545, 4546, 4547]);
    expect(imposters[0]?.stubs).toBeUndefined();
    expect(imposters[0]?.numberOfRequests).toBe(5);
  });

  it('lists them with stubs and no counts when asked for replayable', () => {
    const imposters = list({ replayable: true });
    expect(imposters[0]?.stubs).toHaveLength(5);
    expect(imposters[0]?.numberOfRequests).toBeUndefined();
  });

  it('serves one imposter whole, traffic included', () => {
    const orders = one(4545);
    expect(orders.requests).toHaveLength(5);
    expect(orders.stubs?.[3]?.responses?.[0]?.fault).toBe('CONNECTION_RESET_BY_PEER');
  });

  it('404s a port nothing is on', () => {
    expect(get('/imposters/9999').status).toBe(404);
  });

  it('creates an imposter, and refuses a port already taken', () => {
    const created = handle('POST', '/imposters', {}, { port: 7000, protocol: 'http', stubs: [] });
    expect(created.status).toBe(201);
    expect(list().map((i) => i.port)).toContain(7000);
    expect(handle('POST', '/imposters', {}, { port: 7000, protocol: 'http' }).status).toBe(400);
  });

  it('refuses an imposter with no port', () => {
    expect(handle('POST', '/imposters', {}, { protocol: 'http' }).status).toBe(400);
  });

  it('deletes an imposter, and deleting it twice is not an error', () => {
    expect(handle('DELETE', '/imposters/4547', {}, undefined).status).toBe(200);
    expect(handle('DELETE', '/imposters/4547', {}, undefined).status).toBe(200);
    expect(list()).toHaveLength(2);
  });

  it('replaces every imposter at once', () => {
    const reply = handle(
      'PUT',
      '/imposters',
      {},
      { imposters: [{ port: 8000, protocol: 'http', stubs: [] }] },
    );
    expect(reply.status).toBe(200);
    expect(list().map((i) => i.port)).toEqual([8000]);
  });

  it('adds a stub, at the end or at an index', () => {
    const stub = { predicates: [{ equals: { path: '/new' } }], responses: [{ is: { body: 'n' } }] };
    expect(handle('POST', '/imposters/4546/stubs', {}, { stub }).status).toBe(200);
    expect(one(4546).stubs).toHaveLength(3);
    expect(one(4546).stubs?.[2]?.predicates?.[0]).toEqual({ equals: { path: '/new' } });

    handle('POST', '/imposters/4546/stubs', {}, { stub, index: 0 });
    expect(one(4546).stubs?.[0]?.predicates?.[0]).toEqual({ equals: { path: '/new' } });
  });

  it('replaces and deletes one stub by index', () => {
    const stub = { predicates: [{ equals: { path: '/only' } }], responses: [{ is: { body: 'o' } }] };
    /* The body is the stub itself here — mountebank's putStub reads request.body, and this
       asymmetry with postStub is what a real instance enforces. */
    handle('PUT', '/imposters/4546/stubs/0', {}, stub);
    expect(one(4546).stubs?.[0]?.predicates?.[0]).toEqual({ equals: { path: '/only' } });

    handle('DELETE', '/imposters/4546/stubs/0', {}, undefined);
    expect(one(4546).stubs).toHaveLength(1);
  });

  it('replaces all of an imposter\'s stubs', () => {
    handle('PUT', '/imposters/4545/stubs', {}, { stubs: [] });
    expect(one(4545).stubs).toEqual([]);
  });

  it('refuses a stub index that is not there', () => {
    expect(handle('DELETE', '/imposters/4545/stubs/99', {}, undefined).status).toBe(400);
    expect(handle('PUT', '/imposters/4545/stubs/-1', {}, {}).status).toBe(400);
  });

  it('clears captured requests, and the count with them', () => {
    handle('DELETE', '/imposters/4545/savedRequests', {}, undefined);
    expect(one(4545).requests).toEqual([]);
    expect(list()[0]?.numberOfRequests).toBe(0);
  });

  it('refuses the shapes a real instance refuses', () => {
    /*
     * The bug this pins down: the panel sent `{ stub: … }` to PUT stubs/:index, mountebank
     * read the wrapper as the stub, found no responses in it and answered
     * 400 "'responses' must be a non-empty array". The demo used to accept it, which is how
     * a demo hides a bug instead of exposing it. All four messages are mountebank's own.
     */
    const wrapped = { stub: { predicates: [], responses: [{ is: { body: 'x' } }] } };
    const put = handle('PUT', '/imposters/4546/stubs/0', {}, wrapped);
    expect(put.status).toBe(400);
    expect(JSON.stringify(put.data)).toContain("'responses' must be a non-empty array");

    /* POST is the other way round: it REQUIRES the wrapper. */
    const bare = handle('POST', '/imposters/4546/stubs', {}, { responses: [{ is: {} }] });
    expect(bare.status).toBe(400);
    expect(JSON.stringify(bare.data)).toContain("must contain 'stub' field");

    /* And a stub with no responses is refused wherever it is sent. */
    const empty = { predicates: [], responses: [] };
    expect(handle('POST', '/imposters/4546/stubs', {}, { stub: empty }).status).toBe(400);
    expect(handle('PUT', '/imposters/4546/stubs/0', {}, empty).status).toBe(400);
    expect(
      handle('POST', '/imposters', {}, { port: 8123, protocol: 'http', stubs: [empty] }).status,
    ).toBe(400);
  });

  it('says 501 for anything the panel does not ask for, rather than pretending', () => {
    expect(get('/logs').status).toBe(501);
    expect(handle('PATCH', '/imposters/4545', {}, undefined).status).toBe(501);
  });

  it('starts again from the seed on reset', () => {
    handle('DELETE', '/imposters/4545', {}, undefined);
    expect(list()).toHaveLength(2);
    resetDemo();
    expect(list()).toHaveLength(3);
  });
});
