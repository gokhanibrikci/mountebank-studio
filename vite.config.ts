import { readFileSync } from 'node:fs';

import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The panel's own version, read from package.json and frozen into the build.
 *
 * Settings shows it, because the first thing anyone reporting a bug is asked is
 * which version they are on, and until now the panel could only answer for the
 * mountebank it was pointed at — not for itself.
 */
const VERSION: string = JSON.parse(readFileSync('./package.json', 'utf8')).version;

/**
 * Two ways to reach an instance, and the dev server supports both.
 *
 * DIRECT — an environment whose target is a full URL (`https://mb.example.com`) is
 * called straight from the browser. Nothing here is involved. Being cross-origin,
 * it requires that instance to allow this page:
 *
 *     mb start --origin "http://localhost:5273"
 *
 * THROUGH THIS ORIGIN — an environment whose target is a path (`/mb/stage`) is
 * called on this very origin, and something has to forward it. In production that
 * is one `location` block (see deploy/nginx.conf); in development it is this
 * proxy, filled from MB_PROXY so nothing about any instance has to change:
 *
 *     # .env.local
 *     MB_PROXY=stage=https://mb.stg.example.com,dev=https://mb.dev.example.com
 *
 * gives `/mb/stage` and `/mb/dev`, and those are what you enter as the admin API
 * in the panel. This is the model for an instance somebody else deployed: no flag,
 * no restart, no request to whoever owns it.
 *
 * MB_PROXY has no VITE_ prefix deliberately — it configures the dev server, and
 * must not be readable from client code.
 */
/** `name=url,name=url` → pairs, ignoring anything malformed rather than failing. */
function pairsFromEnv(env: Record<string, string>): [string, string][] {
  const raw = env.MB_PROXY ?? '';
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter((pair) => pair !== '')
    .map((pair) => {
      const at = pair.indexOf('=');
      return at === -1 ? null : [pair.slice(0, at).trim(), pair.slice(at + 1).trim()];
    })
    .filter((pair): pair is [string, string] => pair !== null && pair[0] !== '' && pair[1] !== '');
}

function proxyFromEnv(env: Record<string, string>): Record<string, ProxyOptions> {
  const proxy: Record<string, ProxyOptions> = {};
  for (const [name, target] of pairsFromEnv(env)) {
    proxy[`/mb/${name}`] = {
      target,
      changeOrigin: true,
      secure: false,
      /* The instance knows nothing of the prefix — it serves /imposters at its root. */
      rewrite: (path: string) => path.replace(new RegExp(`^/mb/${name}`), ''),
    };
  }
  return proxy;
}

/**
 * `GET /mb/targets.json` — which name forwards to which instance.
 *
 * Without this the panel could only GUESS a path from an environment's id, and a
 * guess that happens to answer is worse than none: an id outlives the label it was
 * minted from, so `/mb/stage` can be live while the environment called "stage" now
 * points somewhere else entirely. Offering that would repoint an environment at the
 * WRONG instance. So the forwarding layer states its own map, the panel matches on
 * the upstream URL, and no manifest simply means no offer.
 *
 * Production does the same thing with one static location; see deploy/nginx.conf.
 */
function manifestPlugin(env: Record<string, string>): Plugin {
  const body = JSON.stringify(Object.fromEntries(pairsFromEnv(env)));
  return {
    name: 'mb-targets-manifest',
    configureServer(server) {
      server.middlewares.use('/mb/targets.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/mb/targets.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), manifestPlugin(env)],
    define: { __APP_VERSION__: JSON.stringify(VERSION) },
    server: { port: 5273, proxy: proxyFromEnv(env) },
    preview: { port: 5273, proxy: proxyFromEnv(env) },
    test: { include: ['src/**/*.test.ts'] },
  };
});
