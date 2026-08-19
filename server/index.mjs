#!/usr/bin/env node
/**
 * `npx mountebank-studio` — the panel and a Mountebank, on one origin.
 *
 * The panel is a static page that calls an admin API from the browser. Point it
 * straight at an instance and the browser demands that instance allow this page:
 * `mb start --origin …`. That flag is not always yours to add — the instance may
 * belong to a team, or sit behind a gateway.
 *
 * This server removes the question. It serves the panel AND forwards `/mb/local` to
 * a Mountebank it starts itself, so every request the browser makes goes to this one
 * origin. Nothing is cross-origin, so no flag, no restart and no permission is
 * involved anywhere.
 *
 * Three deliberate choices:
 *
 *  • NO DEPENDENCIES of its own. Node's own http and fs are enough for a static
 *    directory and one proxy, and a tool people run through npx should not drag a
 *    web framework — and its advisories — along with it.
 *
 *  • SAFE BY DEFAULT. Mountebank is started bound to loopback with injection OFF,
 *    and its port is never exposed: only this server talks to it. Injection runs
 *    JavaScript out of stub definitions, so it is opt-in with a flag and a warning.
 *
 *  • MOUNTEBANK IS A DEPENDENCY, NOT A COPY. It is resolved from node_modules at
 *    run time, so this package redistributes none of its code and you can pin the
 *    version yourself.
 */

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = resolve(HERE, '..', 'dist');

/* The name the panel knows this instance by: /mb/local, and "local" in the map. */
const ROUTE = 'local';

const HELP = `
  mountebank-studio — a visual console for Mountebank

  Usage
    npx mountebank-studio [options]

  Options
    --port <n>         serve the panel here                      (default 5273)
    --mb-port <n>      start Mountebank here                     (default 2525)
    --mb-url <url>     use a Mountebank ALREADY running there, and start none
    --allow-injection  let stubs run JavaScript. This is code execution: only do
                       it on an instance you would trust with a shell
    --insecure         do not verify the TLS certificate of --mb-url. For an instance
                       behind a certificate you cannot fix, and nothing else
    --host <addr>      bind the panel to this address            (default 127.0.0.1)
                       0.0.0.0 exposes it to your network — see the warning it prints
    --version          print the version
    --help             this

  Examples
    npx mountebank-studio
    npx mountebank-studio --port 8080 --mb-port 3000
    npx mountebank-studio --mb-url http://localhost:2525
    npx mountebank-studio --mb-url https://mountebank.example.com
`;

function parseArgs(argv) {
  const opts = {
    port: 5273,
    mbPort: 2525,
    mbUrl: null,
    allowInjection: false,
    insecure: false,
    host: '127.0.0.1',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error(`${arg} needs a value`);
      }
      i += 1;
      return value;
    };

    if (arg === '--help' || arg === '-h') return { help: true };
    else if (arg === '--version' || arg === '-v') return { version: true };
    else if (arg === '--port') opts.port = Number(next());
    else if (arg === '--mb-port') opts.mbPort = Number(next());
    else if (arg === '--mb-url') opts.mbUrl = next().replace(/\/+$/, '');
    else if (arg === '--allow-injection') opts.allowInjection = true;
    else if (arg === '--insecure') opts.insecure = true;
    else if (arg === '--host') opts.host = next();
    else throw new Error(`unknown option ${arg}`);
  }

  for (const key of ['port', 'mbPort']) {
    if (!Number.isInteger(opts[key]) || opts[key] < 1 || opts[key] > 65535) {
      throw new Error(`${key} must be a port number`);
    }
  }
  return opts;
}

/* ─────────────────────────────  the mountebank  ─────────────────────────── */

/** Where npm put mountebank's own CLI, or null when it is not installed. */
function mountebankBin() {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve('mountebank/bin/mb');
  } catch {
    return null;
  }
}

async function waitForAdminApi(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${url}/config`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return await response.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

function startMountebank(opts) {
  const bin = mountebankBin();
  if (bin === null) {
    console.error(
      [
        '',
        '  Mountebank is not installed next to this package.',
        '',
        '  It is a normal dependency, so this usually means an incomplete install.',
        '  Either reinstall, or point the panel at an instance you already run:',
        '',
        '      npx mountebank-studio --mb-url http://localhost:2525',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  /*
   * --localOnly binds it to loopback, so nothing outside this machine can reach the
   * admin API even if the panel itself is exposed. Injection stays off unless asked
   * for: it executes JavaScript that arrives inside a stub.
   */
  const args = [bin, '--port', String(opts.mbPort), '--localOnly'];
  if (opts.allowInjection) args.push('--allowInjection');

  const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (chunk) => process.stderr.write(`  mountebank: ${chunk}`));
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n  Mountebank exited with code ${code}. Is port ${opts.mbPort} free?\n`);
      process.exit(code);
    }
  });
  return child;
}

/* ────────────────────────────────  serving  ─────────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

/** The static build. Any unknown path is index.html, because routing is client-side. */
function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const asked = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, asked);

  if (!file.startsWith(DIST)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');

  const ext = extname(file);
  /* Hashed assets never change under the same name; index.html always must. */
  const cache = file.includes(`${join('dist', 'assets')}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-store';

  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': cache,
  });
  createReadStream(file).pipe(res);
}

/**
 * `/mb/local/*` → the instance, with the prefix stripped. Same origin as the panel,
 * which is the entire point: the browser never makes a cross-origin request, so
 * CORS, mixed content and private-network rules never enter the picture.
 *
 * The module comes from the target's protocol. It was `http` unconditionally, which made
 * `--mb-url https://…` close the socket instead of answering — and that is precisely the
 * case the flag exists for: an instance somebody else deployed, behind TLS, that you
 * cannot add `--origin` to.
 */
function proxy(req, res, upstream, insecure = false) {
  const target = new URL(upstream);
  const secure = target.protocol === 'https:';
  const path = req.url.replace(new RegExp(`^/mb/${ROUTE}`), '') || '/';

  const forwarded = (secure ? https : http).request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      /* Left out for a default port, so 443 and 80 come from the module rather than
         from a guess here — `new URL()` reports those as an empty string. */
      ...(target.port === '' ? {} : { port: target.port }),
      method: req.method,
      path,
      /* The upstream's own host, so a vhost routes it and TLS gets the right SNI. */
      headers: { ...req.headers, host: target.host },
      ...(secure && insecure ? { rejectUnauthorized: false } : {}),
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  forwarded.on('error', (error) => {
    sendJson(res, 502, {
      errors: [{ code: 'proxy failed', message: `${upstream} did not answer: ${error.message}` }],
    });
  });

  req.pipe(forwarded);
}

/* ──────────────────────────────────  main  ──────────────────────────────── */

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`\n  ${error.message}\n${HELP}`);
    process.exit(2);
  }

  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (opts.version) {
    const pkg = JSON.parse(await readFile(resolve(HERE, '..', 'package.json'), 'utf8'));
    console.log(pkg.version);
    return;
  }

  if (!existsSync(join(DIST, 'index.html'))) {
    console.error(
      [
        '',
        '  The panel has not been built.',
        '',
        '  From a checkout of this repository:   yarn install && yarn build',
        '  From npm this should never happen — please report it.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  /* fetch has no per-call option for this, and the probe below must agree with the
     proxy: promising --insecure and then failing to read /config would be worse than
     not offering the flag. */
  if (opts.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const upstream = opts.mbUrl ?? `http://127.0.0.1:${opts.mbPort}`;
  const child = opts.mbUrl === null ? startMountebank(opts) : null;

  const bootstrap = {
    /*
     * The panel seeds this on a first run, so nobody has to type a URL to begin.
     *
     * No `note`: the panel draws a note as a CAUTION, in amber with an alert icon,
     * and "started by mountebank-studio" is not a caution. Where this environment
     * came from is already legible without one — the sidebar names the route and
     * Settings says it is reached through this page's own host.
     */
    environments: [
      {
        id: ROUTE,
        /*
         * "Local" is only true when this server started the instance. With --mb-url it
         * forwards to somebody else's, and calling a staging instance Local is a lie
         * the sidebar repeats on every screen afterwards.
         */
        label: opts.mbUrl === null ? 'Local' : new URL(upstream).host,
        target: `/mb/${ROUTE}`,
      },
    ],
  };

  const server = http.createServer((req, res) => {
    if (req.url === '/mb/targets.json') {
      /* What this host forwards, so the panel can route by itself. */
      sendJson(res, 200, { [ROUTE]: upstream });
      return;
    }
    if (req.url === '/mb/bootstrap.json') {
      sendJson(res, 200, bootstrap);
      return;
    }
    if (req.url.startsWith(`/mb/${ROUTE}`)) {
      proxy(req, res, upstream, opts.insecure);
      return;
    }
    serveStatic(req, res);
  });

  server.on('error', (error) => {
    const message =
      error.code === 'EADDRINUSE'
        ? `Port ${opts.port} is taken. Try --port with another number.`
        : error.message;
    console.error(`\n  ${message}\n`);
    process.exit(1);
  });

  const info = await waitForAdminApi(upstream);

  server.listen(opts.port, opts.host, () => {
    const where = `http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${opts.port}`;
    const version = info?.version ? `mountebank ${info.version}` : 'mountebank (version unknown)';
    /* One column, whatever the label. "Using your instance" is four characters longer
       than "Started for you", and with a fixed gap it pushed that row out of line. */
    const label = (text) => text.padEnd(25);

    console.log(
      [
        '',
        `  ${label('Mountebank Studio')}${where}`,
        `  ${label(opts.mbUrl === null ? 'Started for you' : 'Using your instance')}${upstream} · ${version}`,
        `  ${label('Reached through')}${where}/mb/${ROUTE} — nothing is cross-origin`,
        '',
        opts.allowInjection
          ? '  Injection is ON. Stubs on this instance can run JavaScript.\n'
          : '',
        opts.insecure
          ? '  TLS verification is OFF for this upstream. Anything sitting between you and\n  it can read and change these requests.\n'
          : '',
        opts.host === '0.0.0.0'
          ? '  This panel is exposed to your network, and whoever opens it can rewrite\n  these mocks. Put authentication in front of it.\n'
          : '',
        '  Ctrl-C to stop.',
        '',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    );
  });

  const stop = () => {
    server.close();
    child?.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

await main();
