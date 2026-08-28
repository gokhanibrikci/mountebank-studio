/**
 * The panel's side of the one file.
 *
 * Two calls, both same-origin, and the part worth pinning down is what happens when the
 * host says no: the filesystem is its business, so its sentence has to reach the screen
 * rather than be replaced by a generic one.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fileSize, moveStore, readStore } from './store';

const answer = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readStore', () => {
  it('reads what the host keeps', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(answer(200, { kept: true, path: '/m/mocks.json' }))),
    );
    expect(await readStore()).toMatchObject({ kept: true, path: '/m/mocks.json' });
  });

  it('is null on a build no host keeps — a 404 is not an error to report', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer(404, null))));
    expect(await readStore()).toBeNull();
  });

  it('is null when the answer is not a store', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer(200, { hello: true }))));
    expect(await readStore()).toBeNull();
  });

  it('is null rather than throwing when nothing answers', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    expect(await readStore()).toBeNull();
  });
});

describe('moveStore', () => {
  it('sends the path and returns the new state', async () => {
    let sent: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        sent = init;
        return Promise.resolve(answer(200, { kept: true, path: '/p/mocks.json' }));
      }),
    );
    const out = await moveStore('/p/mocks.json');
    expect(out.error).toBeNull();
    expect(out.state).toMatchObject({ path: '/p/mocks.json' });
    expect(sent?.method).toBe('PUT');
    expect(JSON.parse(String(sent?.body))).toEqual({ path: '/p/mocks.json' });
  });

  it('carries the host’s own refusal through, word for word', async () => {
    /* "That is a directory. Name the file itself." is worth more than any sentence this
       side could invent — only the host knows what is on the disk. */
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          answer(400, { errors: [{ code: 'bad path', message: 'That is a directory.' }] }),
        ),
      ),
    );
    expect(await moveStore('/tmp')).toEqual({ state: null, error: 'That is a directory.' });
  });

  it('says something useful when the refusal carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer(500, null))));
    expect((await moveStore('/x')).error).toContain('500');
  });
});

describe('fileSize', () => {
  it('reads as a size, not a number of bytes, once it is one', () => {
    expect(fileSize(null)).toBe('not written yet');
    expect(fileSize(503)).toBe('503 bytes');
    expect(fileSize(2048)).toBe('2.0 KB');
    expect(fileSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
