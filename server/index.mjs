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
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = resolve(HERE, '..', 'dist');

/* The name the panel knows the instance this server owns by: /mb/local. */
const ROUTE = 'local';

/*
 * Everything this server forwards, as `name → upstream`.
 *
 * It starts with the instance this server owns and GROWS: the panel can ask for another
 * upstream at run time (POST /mb/targets), which is what makes adding an environment in
 * the browser enough. Without that, an instance you cannot add `--origin` to could only
 * be reached by restarting this server with --mb-url, and an environment added in the UI
 * failed for a reason nothing in the UI could fix.
 *
 * It is deliberately NOT written to disk. The panel remembers which of its environments
 * it asked to have forwarded and asks again on load, so the record lives with the person
 * who made the choice rather than in a file nobody knows about.
 */
const forwards = new Map();

/** A route name from a URL: the host, and the port when there is one. */
function routeName(url) {
  const { hostname, port } = new URL(url);
  const base = `${hostname}${port === '' ? '' : `-${port}`}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base === '' ? 'upstream' : base;
}

/** Same instance? Compared the way the panel compares them. */
const sameUpstream = (a, b) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

const HELP = `
  mountebank-studio — a visual console for Mountebank

  Usage
    npx mountebank-studio [options]

  Options
    --port <n>         serve the panel here                      (default 5273)
    --mb-port <n>      start Mountebank here                     (default 2525)
    --mb-url <url>     use a Mountebank ALREADY running there, and start none
    --store <file>     the single JSON file everything is kept in, read at startup and
                       rewritten on every change. Settings can move it, and the choice
                       is remembered (default ~/.mountebank-studio/local-<mb-port>.json)
    --datadir <path>   ALSO keep mountebank's own directory tree here. Rarely wanted:
                       the file above is the one this panel reads and writes
    --memory           keep nothing: the instance holds everything and loses it when
                       you stop it
    --allow-injection  let stubs run JavaScript. This is code execution: only do
                       it on an instance you would trust with a shell
    --insecure         stop verifying TLS certificates. It applies to EVERY https
                       connection this process makes — the instance you name and any
                       other it is later asked to forward to — not just to --mb-url
    --host <addr>      bind the panel to this address            (default 127.0.0.1)
                       0.0.0.0 exposes it to your network — see the warning it prints
    --version          print the version
    --help             this

  Examples
    npx mountebank-studio
    npx mountebank-studio --port 8080 --mb-port 3000
    npx mountebank-studio --mb-url http://localhost:2525
    npx mountebank-studio --mb-url https://mountebank.example.com
    npx mountebank-studio --store ./mocks.json
    npx mountebank-studio --memory
`;

function parseArgs(argv) {
  const opts = {
    port: 5273,
    mbPort: 2525,
    mbUrl: null,
    allowInjection: false,
    insecure: false,
    /* null means "ask the settings file, then fall back to the default". */
    store: null,
    /* mountebank's own tree, off unless asked for: the file is the store. */
    datadir: null,
    memory: false,
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
    else if (arg === '--store') opts.store = next();
    else if (arg === '--datadir') opts.datadir = next();
    else if (arg === '--memory') opts.memory = true;
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

/**
 * Where the imposters you create are kept.
 *
 * KEPT BY DEFAULT, and that is the point. Mountebank holds imposters in memory unless it is
 * given a --datadir, so closing the terminal used to throw away everything built in the
 * session — with nothing on screen saying it would. For a panel whose whole job is building
 * mocks by hand, losing them on Ctrl-C is the wrong default.
 *
 * The path is under the user's home rather than the working directory, because "where I ran
 * it from" is not something anyone remembers. `--store` puts it anywhere — a project
 * directory, if these mocks belong to a repository — the panel can move it in Settings, and
 * `--memory` opts out for a throwaway session.
 */
async function storePathFor(opts) {
  if (opts.memory) return null;
  if (opts.store !== null) return resolve(process.cwd(), opts.store);
  /* Remembered per instance for the same reason the default is keyed: a path chosen for
     one instance is not a path chosen for another. */
  const remembered = (await readSettings()).stores?.[String(opts.mbPort)];
  if (typeof remembered === 'string' && remembered.trim() !== '') {
    return resolve(process.cwd(), remembered);
  }
  return defaultStore(opts.mbPort);
}

/* ══════════════════════════════════════════════════════════════════════════
   One file
   ══════════════════════════════════════════════════════════════════════════

   Everything an instance holds — imposters, their stubs, responses and settings —
   kept as a single JSON document rather than mountebank's own directory tree.

   The tree works, and it is what --datadir does: a folder per imposter, a folder per
   stub, one file per response. Nothing about it is wrong except that it cannot be
   opened, read, diffed, committed or sent to somebody. What people want to keep is
   one file.

   So this server owns the persistence instead:

     • at startup, mountebank is handed the file with --configfile, and loads it;
     • at runtime it holds everything in memory — there is no --datadir, because two
       stores for one truth is how they come to disagree;
     • after any request through this server that CHANGES the instance, the whole set
       is read back with ?replayable=true and written out again.

   --noParse goes with --configfile, always. Without it mountebank runs the file
   through EJS on load, so a recorded response body containing `<%` — a JSP fragment,
   an ASP page, anything quoting a template — is executed rather than served back.
   That would corrupt the very mocks this is meant to preserve.

   The write is atomic: a temporary file in the same directory, then rename. A crash
   halfway through leaves the previous version, not half of the new one.
*/

/** Where the panel remembers the path between runs, so it is a setting and not a flag. */
const SETTINGS_FILE = join(homedir(), '.mountebank-studio', 'settings.json');

/**
 * The default file, when nobody has chosen one.
 *
 * KEYED BY THE MOUNTEBANK PORT, the way the directory it replaced was. `--mb-port 3000` is
 * a different instance and gets a different file; sharing one meant two servers on one
 * machine writing over each other, and the second one starting with the first one's
 * imposters — which is how CI found it, with an EADDRINUSE on a port it never asked for.
 */
const defaultStore = (mbPort) => join(homedir(), '.mountebank-studio', `local-${mbPort}.json`);

/** What this run is keeping, and where. Mutable: the panel can move it. */
const store = {
  /** Absolute path of the single file, or null when --memory was asked for. */
  path: null,
  /** When it was last written, as epoch ms, or null if not yet this run. */
  savedAt: null,
  /** The last write that failed, so the panel can say so rather than look fine. */
  error: null,
  /** Set while a write is in flight, so overlapping changes coalesce. */
  writing: false,
  /** Another change arrived mid-write; write once more when this one lands. */
  again: false,
};

async function readSettings() {
  try {
    const body = JSON.parse(await readFile(SETTINGS_FILE, 'utf8'));
    return typeof body === 'object' && body !== null ? body : {};
  } catch {
    return {};
  }
}

/** Remember the file this instance keeps its mocks in, leaving other instances alone. */
async function rememberStore(mbPort, path) {
  const current = await readSettings();
  const stores = typeof current.stores === 'object' && current.stores !== null ? current.stores : {};
  const next = { ...current, stores: { ...stores, [String(mbPort)]: path } };
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  await writeFile(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

/**
 * A path this server is willing to write to.
 *
 * The panel can set this, and the panel is a web page — so the answer to "which file"
 * has to be checked here rather than trusted. Relative paths resolve against the
 * directory the command was run from, which is what somebody typing `./mocks.json`
 * means. Everything else is refused with a reason.
 */
function checkStorePath(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: 'Give a path to a file.' };
  const path = resolve(process.cwd(), raw.trim().replace(/^~(?=\/|$)/, homedir()));
  if (!isAbsolute(path)) return { error: 'That is not a path.' };
  if (existsSync(path)) {
    let stat;
    try {
      stat = statSync(path);
    } catch (error) {
      return { error: `That path cannot be read: ${error.message}` };
    }
    if (stat.isDirectory()) return { error: 'That is a directory. Name the file itself.' };
    /* Refusing to clobber somebody's unrelated file on a typo. A file this server can
       recognise as its own — valid JSON with an `imposters` array — is fair game. */
    try {
      const body = JSON.parse(readFileSync(path, 'utf8'));
      if (!Array.isArray(body?.imposters)) {
        return {
          error: 'That file exists and is not a mountebank configuration. Pick another name.',
        };
      }
    } catch {
      return { error: 'That file exists and is not JSON. Pick another name.' };
    }
  }
  return { path };
}

/** Everything the instance holds, in the shape --configfile reads back. */
async function snapshot(upstream) {
  const url = `${upstream}/imposters?replayable=true`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`the instance answered ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body?.imposters)) throw new Error('the instance did not return imposters');
  return { imposters: body.imposters };
}

/**
 * Write the file, once, coalescing anything that arrives while it is happening.
 *
 * Never throws at the caller: a failed save must not turn into a failed request the
 * user made. It is recorded instead, and the panel reports it.
 */
async function saveStore(upstream) {
  if (store.path === null) return;
  if (store.writing) {
    store.again = true;
    return;
  }
  store.writing = true;
  try {
    const document = await snapshot(upstream);
    mkdirSync(dirname(store.path), { recursive: true });
    const temporary = `${store.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    await rename(temporary, store.path);
    store.savedAt = Date.now();
    store.error = null;
  } catch (error) {
    store.error = error.message;
    console.error(`  ! could not write ${store.path}: ${error.message}`);
  } finally {
    store.writing = false;
    if (store.again) {
      store.again = false;
      await saveStore(upstream);
    }
  }
}

/**
 * Carry a previous version's imposters into the file, once.
 *
 * Up to 0.4.7 this server kept them in mountebank's own directory tree under
 * ~/.mountebank-studio/local-<port>. Somebody updating should not have to notice that the
 * storage changed, and least of all by finding their mocks gone. So on the first run where
 * the file does not exist and that tree does, a throwaway instance is started on a free
 * port to read the tree, and what it holds is written to the file.
 *
 * The tree is left where it is. Deleting somebody's data to tidy up after a migration is
 * not this program's decision.
 */
async function migrateFromDatadir(opts) {
  if (existsSync(store.path)) return;
  const legacy = join(homedir(), '.mountebank-studio', `local-${opts.mbPort}`);
  if (!existsSync(legacy)) return;
  /* An empty tree is nothing to carry. */
  try {
    if (readdirSync(legacy).length === 0) return;
  } catch {
    return;
  }

  const bin = mountebankBin();
  if (bin === null) return;
  const port = opts.mbPort + 10000 > 65535 ? opts.mbPort - 1 : opts.mbPort + 10000;
  const child = spawn(process.execPath, [bin, '--port', String(port), '--localOnly', '--nologfile', '--datadir', legacy], {
    stdio: 'ignore',
  });
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((done) => setTimeout(done, 250));
      try {
        const document = await snapshot(`http://127.0.0.1:${port}`);
        if (document.imposters.length === 0) return;
        mkdirSync(dirname(store.path), { recursive: true });
        await writeFile(store.path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
        console.log(
          `  · carried ${document.imposters.length} imposter${document.imposters.length === 1 ? '' : 's'} from ${legacy} into ${store.path}`,
        );
        return;
      } catch {
        /* not up yet, or nothing to read */
      }
    }
  } finally {
    child.kill();
  }
}

/** What the panel is told about the file: where, how big, when, and what went wrong. */
function describeStore(opts) {
  if (opts.mbUrl !== null) {
    /* Somebody else's instance. Its persistence is its own business, and writing their
       imposters into a file here would be this panel inventing a policy for it. */
    return { kept: false, reason: 'this panel was pointed at an instance it did not start' };
  }
  if (store.path === null) {
    return { kept: false, reason: 'started with --memory, so nothing is kept' };
  }
  let bytes = null;
  try {
    bytes = statSync(store.path).size;
  } catch {
    bytes = null;
  }
  return {
    kept: true,
    path: store.path,
    exists: bytes !== null,
    bytes,
    savedAt: store.savedAt,
    error: store.error,
    /* Where a relative path would land, so the panel can say so before it is typed. */
    cwd: process.cwd(),
  };
}

/**
 * `PUT /mb/store` — "keep it here from now on."
 *
 * Loopback and same-origin only, like every other write this server accepts from the
 * page: it names a file on the machine, and a page from anywhere else has no business
 * choosing one. The current mocks are written to the new path BEFORE it takes effect, so
 * moving cannot lose them, and the choice is remembered for the next run.
 */
async function moveStore(req, res, opts, origin, upstream) {
  if (!mayRegister(opts)) {
    sendJson(res, 403, {
      errors: [
        {
          code: 'not allowed',
          message: `This panel is bound to ${opts.host}, not loopback. Choosing a file on this machine from a page served to the network is not something this server will do.`,
        },
      ],
    });
    return;
  }
  const from = req.headers.origin;
  if (from !== undefined && from !== origin) {
    sendJson(res, 403, { errors: [{ code: 'not allowed', message: `${from} is not this panel.` }] });
    return;
  }
  if (opts.mbUrl !== null || store.path === null) {
    sendJson(res, 409, {
      errors: [{ code: 'not kept', message: describeStore(opts).reason }],
    });
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    sendJson(res, 400, { errors: [{ code: 'bad request', message: error.message }] });
    return;
  }

  const checked = checkStorePath(body?.path);
  if (checked.error !== undefined) {
    sendJson(res, 400, { errors: [{ code: 'bad path', message: checked.error }] });
    return;
  }

  const previous = store.path;
  store.path = checked.path;
  await saveStore(upstream);
  if (store.error !== null) {
    /* The new path could not be written, so it does not become the one in force. */
    const failure = store.error;
    store.path = previous;
    store.error = null;
    sendJson(res, 400, { errors: [{ code: 'bad path', message: failure }] });
    return;
  }

  await rememberStore(opts.mbPort, checked.path);
  console.log(`  · imposters now kept in ${checked.path}`);
  sendJson(res, 200, describeStore(opts));
}

/** Which requests change the instance, and therefore call for a write. */
const CHANGES = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/* ─────────────────────────────  the mountebank  ─────────────────────────── */

/**
 * Where npm put mountebank's own CLI, or null when it is not installed.
 *
 * `@mbtest/mountebank` is the maintained package. Mountebank moved to the
 * mountebank-testing organisation in 2025 and renamed as it went, and the old
 * `mountebank` name on npm stopped at 2.9.1 — published August 2023, carrying three
 * years of dependency advisories that 2.9.2 through 2.9.4 fixed. That is what this
 * package depends on now.
 *
 * The old name is still tried, second, for anyone whose environment already has it: the
 * admin API this panel speaks to is the same one either way, and refusing to start
 * because the package is called the older thing would help nobody.
 */
function mountebankBin() {
  const require = createRequire(import.meta.url);
  for (const name of ['@mbtest/mountebank/bin/mb', 'mountebank/bin/mb']) {
    try {
      return require.resolve(name);
    } catch {
      /* Not this one; try the next. */
    }
  }
  return null;
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

/*
 * Mountebank's own output, filtered on the way through.
 *
 * ITS LOG GOES TO STDOUT, and most of it duplicates what the banner above already says
 * ("now taking orders", the version, the port). Printing all of it would bury this
 * server's own three lines. Ignoring the stream entirely — which is what this did — hid
 * the lines that matter instead: a winston `error:` or `warn:` from the instance was
 * discarded along with the chatter. Only those two get through now.
 *
 * ITS STDERR carries one warning on every start, on Node 21 and later:
 *
 *     DeprecationWarning: The `punycode` module is deprecated
 *
 * Mountebank supports an smtp imposter, so it depends on smtp-server, mailparser and
 * nodemailer, and those require Node's built-in punycode. Nobody reading that can act on
 * it — the fix belongs to those packages, three levels down a dependency this package
 * pins — and printing it on every start teaches people to ignore what this server says.
 * It is dropped; every other line, including any other deprecation, comes through.
 *
 * Lines are also assembled before being labelled. A chunk can hold several, and
 * prefixing the chunk labels only the first — which left later lines hanging off the
 * margin, looking like a broken tool.
 */
const ANSI = /\u001b\[[0-9;]*m/g;
const PUNYCODE = /DeprecationWarning: The `punycode` module is deprecated/;
/* Winston writes `error: [mb:2525] …`; the colour codes are stripped before matching. */
const WORTH_SAYING = /^(error|warn)\b/i;

function pipeLines(stream, keep) {
  let rest = '';
  stream.on('data', (chunk) => {
    const lines = (rest + chunk).split('\n');
    /* The tail may be half a line; hold it until its newline arrives. */
    rest = lines.pop() ?? '';
    for (const line of lines) {
      const plain = line.replace(ANSI, '').trim();
      if (plain === '' || !keep(plain)) continue;
      process.stderr.write(`  mountebank: ${line.replace(ANSI, '').trimEnd()}\n`);
    }
  });
}

function pipeChild(child) {
  /* Anything but the noise, and the hint that belongs to it. */
  let droppedNoise = false;
  pipeLines(child.stderr, (line) => {
    if (PUNYCODE.test(line)) {
      droppedNoise = true;
      return false;
    }
    if (droppedNoise && line.includes('--trace-deprecation')) {
      droppedNoise = false;
      return false;
    }
    droppedNoise = false;
    return true;
  });

  pipeLines(child.stdout, (line) => WORTH_SAYING.test(line));
}

function startMountebank(opts) {
  const bin = mountebankBin();
  if (bin === null) {
    console.error(
      [
        '',
        '  Mountebank is not installed next to this package.',
        '',
        '  @mbtest/mountebank is a normal dependency, so this usually means an incomplete',
        '  install.',
        '  Either reinstall, or point the panel at an instance you already run:',
        '',
        '      npx mountebank-studio --mb-url http://localhost:2525',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  /*
   * --localOnly makes it REFUSE connections from anything but this machine — it still
   * listens on every interface; mountebank checks the source address per connection. So
   * the admin API is not reachable from your network directly, though an exposed panel
   * still forwards to it on /mb/local, which is what the --host warning is about.
   * Injection stays off unless asked for: it executes JavaScript that arrives inside a
   * stub.
   */
  /*
   * --nologfile because this process already reports what matters. Without it mountebank
   * writes mb.log into whatever directory the command was run from — somebody's
   * repository, typically — and leaves it there after Ctrl-C. Its warnings and errors are
   * already forwarded to this terminal by pipeChild.
   */
  const args = [bin, '--port', String(opts.mbPort), '--localOnly', '--nologfile'];
  if (opts.allowInjection) args.push('--allowInjection');

  /*
   * The file, when there is one to read. Mountebank refuses to start if --configfile
   * names something that does not exist, so a first run simply starts empty and the
   * file appears with the first imposter.
   *
   * --noParse always goes with it: without it the file is run through EJS on load, and
   * a recorded body containing `<%` would be executed instead of served.
   */
  if (store.path !== null && existsSync(store.path)) {
    args.push('--configfile', store.path, '--noParse');
  }
  if (opts.datadir !== null) args.push('--datadir', opts.datadir);

  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  pipeChild(child);
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n  Mountebank exited with code ${code}. Is port ${opts.mbPort} free?\n`);
      process.exit(code);
    }
  });
  return child;
}

/*
 * Whether this server may be told to forward somewhere new.
 *
 * Only while it is bound to loopback. Exposed to a network, an endpoint that makes this
 * process fetch any URL it is handed is a proxy for whoever can reach it, and no amount
 * of care in the panel would change that.
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const mayRegister = (opts) => LOOPBACK.has(opts.host);

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
function proxy(req, res, route, upstream, insecure = false) {
  const target = new URL(upstream);
  const secure = target.protocol === 'https:';
  const path = req.url.slice(`/mb/${route}`.length) || '/';

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

/** One JSON body, with a ceiling so a stray stream cannot fill memory. */
function readJson(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * `POST /mb/targets` — "forward to this one as well."
 *
 * The panel calls it when a read failed because the instance refuses this origin and
 * `--origin` is not the user's to add. Registering the upstream here is enough: the
 * manifest then names it, and the panel routes that environment through this origin by
 * itself, without the environment's address being rewritten.
 *
 * Two refusals worth reading:
 *
 *  • NOT ON A PUBLIC BIND. See `mayRegister`.
 *  • NOT CROSS-ORIGIN. A page on another site must not be able to make this process
 *    fetch a URL of its choosing. Browsers preflight a JSON POST and this server answers
 *    no preflight, so such a request never arrives — the Origin check is the belt to
 *    that braces, and costs one comparison.
 */
async function registerForward(req, res, opts, origin) {
  if (!mayRegister(opts)) {
    sendJson(res, 403, {
      errors: [
        {
          code: 'forwarding refused',
          message:
            `This panel is bound to ${opts.host}, not loopback. Registering a forward would ` +
            `make this server fetch URLs on behalf of anyone who can reach it, so it is only ` +
            `allowed on 127.0.0.1.`,
        },
      ],
    });
    return;
  }

  const from = req.headers.origin;
  if (from !== undefined && from !== origin) {
    sendJson(res, 403, {
      errors: [{ code: 'forwarding refused', message: `${from} is not this panel.` }],
    });
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    sendJson(res, 400, { errors: [{ code: 'bad request', message: error.message }] });
    return;
  }

  const url = typeof body?.url === 'string' ? body.url.trim().replace(/\/+$/, '') : '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (parsed === null || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    sendJson(res, 400, {
      errors: [{ code: 'bad request', message: `${url || '(nothing)'} is not an http(s) URL.` }],
    });
    return;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    sendJson(res, 400, {
      errors: [
        {
          code: 'bad request',
          message: 'Credentials in the URL are not forwarded. Put them in a header instead.',
        },
      ],
    });
    return;
  }

  /* Idempotent: the same upstream keeps the name it already has. */
  for (const [name, existing] of forwards) {
    if (sameUpstream(existing, url)) {
      sendJson(res, 200, { name, route: `/mb/${name}`, url: existing });
      return;
    }
  }

  let name = routeName(url);
  /* A name is a path segment, and two upstreams must never share one. */
  for (let n = 2; forwards.has(name); n += 1) name = `${routeName(url)}-${n}`;
  forwards.set(name, url);

  console.log(`  + forwarding /mb/${name} → ${url}`);
  sendJson(res, 201, { name, route: `/mb/${name}`, url });
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

  /*
   * Where everything is kept. Resolved before the instance starts, because the file is
   * what the instance is started FROM.
   */
  if (opts.mbUrl === null) {
    store.path = await storePathFor(opts);
    if (store.path !== null) await migrateFromDatadir(opts);
  }

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
        /*
         * The instance's OWN address, not the route this server forwards it on.
         *
         * An environment answers "which Mountebank", and `/mb/local` answers "by which
         * road" — a fact about this process that nobody typed and nobody should have to
         * read. Published as the address the banner above already printed, it matches
         * what somebody would reach for `curl` with, and the panel still routes it
         * through this origin by itself: `resolveTarget` looks it up in the manifest and
         * calls /mb/local, so the request stays same-origin and the instance keeps
         * needing no --origin flag. The road remains, and stops being paperwork.
         */
        target: upstream,
      },
    ],
  };

  const origin = `http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${opts.port}`;

  forwards.set(ROUTE, upstream);

  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];

    if (path === '/mb/targets.json') {
      /* What this host forwards, so the panel can route by itself. */
      sendJson(res, 200, Object.fromEntries(forwards));
      return;
    }
    if (path === '/mb/bootstrap.json') {
      sendJson(res, 200, bootstrap);
      return;
    }
    if (path === '/mb/forwarding') {
      /* Whether asking is worth the panel's while, and why not when it is not. */
      sendJson(
        res,
        200,
        mayRegister(opts)
          ? { enabled: true }
          : {
              enabled: false,
              reason: `this panel is bound to ${opts.host} rather than loopback`,
            },
      );
      return;
    }
    if (path === '/mb/targets' && req.method === 'POST') {
      void registerForward(req, res, opts, origin);
      return;
    }

    /* Where everything is kept, and — from the panel — where it should be kept. */
    if (path === '/mb/store' && req.method === 'GET') {
      sendJson(res, 200, describeStore(opts));
      return;
    }
    if (path === '/mb/store' && req.method === 'PUT') {
      void moveStore(req, res, opts, origin, upstream);
      return;
    }

    /* Any registered route, longest name first so one name cannot shadow another. */
    if (path.startsWith('/mb/')) {
      const names = [...forwards.keys()].sort((a, b) => b.length - a.length);
      const hit = names.find((name) => path === `/mb/${name}` || path.startsWith(`/mb/${name}/`));
      if (hit !== undefined) {
        /*
         * A change to the instance this server owns is a change to the file. Written
         * after the reply has been handed back, so a slow disk never becomes a slow
         * request, and coalesced inside saveStore so a burst of edits is one write.
         */
        if (hit === ROUTE && store.path !== null && CHANGES.has(req.method)) {
          res.on('finish', () => {
            if (res.statusCode < 400) void saveStore(upstream);
          });
        }
        proxy(req, res, hit, forwards.get(hit), opts.insecure);
        return;
      }
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
    const version = info?.version ? `mountebank ${info.version}` : 'mountebank (version unknown)';
    /* One column, whatever the label. "Using your instance" is four characters longer
       than "Started for you", and with a fixed gap it pushed that row out of line. */
    const label = (text) => text.padEnd(25);

    console.log(
      [
        '',
        `  ${label('Mountebank Studio')}${origin}`,
        `  ${label(opts.mbUrl === null ? 'Started for you' : 'Using your instance')}${upstream} · ${version}`,
        `  ${label('Reached through')}${origin}/mb/${ROUTE} — nothing is cross-origin`,
        /*
         * Where the imposters go, said every time. A kept directory nobody can find is not
         * much better than no directory, and the memory case has to be louder than silence:
         * that is the one where closing this window loses work.
         */
        opts.mbUrl !== null
          ? ''
          : store.path === null
            ? `  ${label('Not kept')}--memory: imposters live in this process and go when it stops`
            : `  ${label('Imposters kept in')}${store.path}`,
        '',
        opts.allowInjection
          ? '  Injection is ON. Stubs on this instance can run JavaScript.\n'
          : '',
        opts.insecure
          ? '  TLS verification is OFF for every https connection this process makes, not\n  just the one named. Anything sitting between you and them can read and change\n  these requests.\n'
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

  /*
   * One last write on the way out.
   *
   * Every change is already written as it happens, so this is a belt: it catches a change
   * made in the last few milliseconds, and anything done directly to the instance's own
   * port rather than through this server. Bounded, because a shutdown that hangs on a
   * disk is worse than a save that was probably redundant.
   */
  const stop = () => {
    server.close();
    const done = () => {
      child?.kill();
      process.exit(0);
    };
    if (store.path === null || opts.mbUrl !== null) {
      done();
      return;
    }
    const bail = setTimeout(done, 2000);
    void saveStore(upstream).finally(() => {
      clearTimeout(bail);
      done();
    });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

await main();
