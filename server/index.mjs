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
    --allow-injection  let stubs run JavaScript, and keep it on for this machine from
                       now on. This is code execution: only do it on a machine you
                       would trust with a shell. Settings can turn it on too
    --no-injection     the opposite, and also remembered
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
    /* null means "whatever this machine last decided"; true/false is this run saying so. */
    injection: null,
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
    else if (arg === '--allow-injection') opts.injection = true;
    else if (arg === '--no-injection') opts.injection = false;
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
  /**
   * Why the file could not be loaded at startup, or null when it was.
   *
   * Mountebank REFUSES TO START on a --configfile it will not accept — an injected
   * response with injection off is the common one — and it exits, taking the panel with
   * it. That left somebody with mocks they could not reach and no screen to fix it from.
   *
   * So a file that fails is a state, not a fatal error: the instance is started without
   * it, the file is left exactly as it is, and NOTHING IS WRITTEN while this is set.
   * Overwriting the file that could not be loaded with the empty instance that replaced
   * it is the one unrecoverable thing here.
   */
  loadFailed: null,
};

async function readSettings() {
  try {
    const body = JSON.parse(await readFile(SETTINGS_FILE, 'utf8'));
    return typeof body === 'object' && body !== null ? body : {};
  } catch {
    return {};
  }
}

/**
 * Remember something under one key, leaving the rest of that section alone.
 *
 * The key is an instance's port, or the literal `default` for a choice that applies to
 * every instance on this machine.
 */
async function remember(section, key, value) {
  const current = await readSettings();
  const group = typeof current[section] === 'object' && current[section] !== null ? current[section] : {};
  const next = { ...current, [section]: { ...group, [String(key)]: value } };
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  await writeFile(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

const rememberStore = (mbPort, path) => remember('stores', mbPort, path);

/**
 * Remember what somebody decided about injected JavaScript.
 *
 * Twice: for this instance, and for this machine. A setting the panel changes has to
 * survive the restart or it is not a setting — without that, turning it on and closing the
 * terminal left a store full of injected responses and an instance started without the
 * flag, which mountebank refuses to load, so the next start did not come up at all.
 *
 * And the machine-wide half is the answer to "why am I being asked again": somebody who has
 * said yes once, here, has said it. A later instance on another port inherits it rather
 * than starting the conversation over. Turning it off writes false to both, so off is off.
 */
async function rememberInjection(mbPort, allow) {
  await remember('injection', mbPort, allow);
  await remember('injection', 'default', allow);
}

/**
 * Whether this instance should accept injected JavaScript.
 *
 * Three answers, most specific first:
 *
 *   1. this run said so — `--allow-injection` or `--no-injection`;
 *   2. this instance was told so before, from Settings;
 *   3. this MACHINE has it on by default, which is what `--allow-injection` writes.
 *
 * The shipped default is still off, and that is deliberate: an instance accepting injection
 * runs whatever JavaScript a stub carries, with a real `require`, as whoever started it, and
 * a panel installed from npm should not arrive that way. But it is off for the FIRST run
 * only — one flag or one press is meant to settle it for good, on the machine of somebody
 * who has decided. Asking again every morning is not security, it is a nag.
 */
async function injectionFor(opts) {
  if (opts.injection !== null) return opts.injection;
  const settings = await readSettings();
  const perInstance = settings.injection?.[String(opts.mbPort)];
  if (typeof perInstance === 'boolean') return perInstance;
  return settings.injection?.default === true;
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
 * Write the file. Serialised, and always awaitable.
 *
 * It used to return early when a write was already in flight, setting a flag so one more
 * would follow. That is fine for a change arriving on its own — but a caller that AWAITS
 * this, as the restart does, was then told the mocks were on disk when they were not, and
 * the process holding them was about to be killed. So every call queues behind the last
 * and resolves when its own write is done. The documents are small and the writes are
 * rare; there was nothing worth being clever for.
 *
 * Never throws at the caller: a failed save must not turn into a failed request somebody
 * made. It is recorded instead, and the panel reports it.
 */
let writes = Promise.resolve();

async function writeStoreOnce(upstream) {
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
  }
}

async function saveStore(upstream) {
  if (store.path === null) return;
  /* The instance is empty because the file would not load. Writing it back would replace
     mocks somebody still has with the nothing that replaced them. */
  if (store.loadFailed !== null) return;
  writes = writes.then(() => writeStoreOnce(upstream));
  await writes;
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

/** Wait until the instance answers, or give up. */
async function waitForInstance(upstream, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${upstream}/config`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  return false;
}

/**
 * `POST /mb/instance` — restart the instance this server started, with different flags.
 *
 * Only `allowInjection` for now, because it is the only one that cannot be changed any
 * other way and that somebody hits in the middle of writing a stub. Everything survives:
 * the mocks are in the file, and the file is what the new process is started from.
 *
 * Guarded like every other write from the page. Injection is code execution on this
 * machine, so it is worth being exact about who can ask: loopback, same origin, and an
 * instance this server owns.
 */
async function restartInstance(req, res, opts, origin, upstream) {
  if (!mayRegister(opts)) {
    sendJson(res, 403, {
      errors: [
        {
          code: 'not allowed',
          message: `This panel is bound to ${opts.host}, not loopback. Turning on injection from a page served to the network is not something this server will do.`,
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
  if (opts.mbUrl !== null || instance === null) {
    sendJson(res, 409, {
      errors: [
        {
          code: 'not ours',
          message: 'This panel was pointed at an instance it did not start, so it cannot restart it.',
        },
      ],
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
  if (typeof body?.allowInjection !== 'boolean') {
    sendJson(res, 400, {
      errors: [{ code: 'bad request', message: 'Expected { "allowInjection": true | false }.' }],
    });
    return;
  }

  /*
   * Written first. The new process is started FROM the file, so anything not in it yet
   * would be lost — including a change made in the last few milliseconds.
   *
   * Unless the file is what failed to load: then it is the truth and the running instance
   * is the empty thing, so there is nothing to write and everything to read.
   */
  const retryingLoad = store.loadFailed !== null;
  if (retryingLoad) store.loadFailed = null;
  else await saveStore(upstream);
  if (!retryingLoad && store.error !== null) {
    sendJson(res, 409, {
      errors: [
        {
          code: 'not saved',
          message: `The mocks could not be written to ${store.path} (${store.error}), so restarting would lose them.`,
        },
      ],
    });
    return;
  }

  const previous = opts.allowInjection;
  opts.allowInjection = body.allowInjection;
  const old = instance;
  old.restarting = true;
  old.kill();
  await new Promise((done) => {
    old.once('exit', done);
    setTimeout(done, 3000);
  });

  startMountebank(opts);
  if (!(await waitForInstance(upstream))) {
    /* Put it back the way it was rather than leaving somebody with no instance. */
    opts.allowInjection = previous;
    if (retryingLoad) store.loadFailed = 'mountebank would not start with this file';
    instance?.kill();
    startMountebank(opts);
    await waitForInstance(upstream);
    sendJson(res, 500, {
      errors: [
        {
          code: 'restart failed',
          message: 'The instance did not come back with that flag, so it was started again as it was.',
        },
      ],
    });
    return;
  }

  /* Remembered, so `mountebank-studio` on its own comes back the same way. Without this
     the next start refused the file it had just been told to write. */
  await rememberInjection(opts.mbPort, opts.allowInjection);
  console.log(`  · instance restarted with injection ${opts.allowInjection ? 'ON' : 'off'}`);
  sendJson(res, 200, { allowInjection: opts.allowInjection });
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
    /* Set when mountebank refused the file at startup: the mocks in it are NOT running,
       and nothing will be written over it until they are. */
    loadFailed: store.loadFailed,
    /* Where a relative path would land, so the panel can say so before it is typed. */
    cwd: process.cwd(),
    /*
     * Where an injected response can keep `config.state` between restarts.
     *
     * Mountebank holds that object in memory and offers no way to read or set it from the
     * outside, so this server cannot save it — but injected code runs inside that process
     * with a real `require`, so it can save it itself. The panel wraps a function with the
     * few lines that do it; the path comes from here so the two agree.
     */
    statePath: store.path.replace(/(\.json)?$/, '.state.json'),
    allowInjection: opts.allowInjection === true,
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
  /* Kept as well as printed: when it exits on a file it would not load, its own error
     line is the only sentence that says why, and "exited with code 1" is not one. */
  child.said = [];
  /* Anything but the noise, and the hint that belongs to it. */
  let droppedNoise = false;
  pipeLines(child.stderr, (line) => {
    child.said.push(line);
    if (child.said.length > 200) child.said.shift();
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

/**
 * The instance this server started, kept so it can be replaced.
 *
 * `--allowInjection` is a startup flag: mountebank cannot be told to accept injection
 * while it is running. Since this server owns both the process AND the file everything
 * lives in, turning it on is a restart it can perform — kill, start again with the flag,
 * and the mocks come back from the file. That is a different thing from asking somebody
 * to find the terminal, stop it, and remember the flag.
 */
let instance = null;

/**
 * Anything in the store that mountebank will only run with --allowInjection.
 *
 * Checked BEFORE the file is handed over, because the alternative was a race that this
 * server lost on somebody else's machine: mountebank's admin port comes up first and its
 * own CLI then posts the imposters, so "did it ever answer" is true by the time it dies on
 * the file. A rule this simple should not be discovered by watching a process exit.
 *
 * The three names are mountebank's own gate — `inject` on a response or a predicate,
 * `decorate` and `shellTransform` among the behaviors — and it refuses the whole
 * configuration if any of them is present without the flag. Measured on 2.9.4.
 */
const INJECTION_KEYS = new Set(['inject', 'decorate', 'shellTransform']);

function findsInjection(value) {
  if (Array.isArray(value)) return value.some(findsInjection);
  if (typeof value !== 'object' || value === null) return false;
  for (const [key, inner] of Object.entries(value)) {
    if (INJECTION_KEYS.has(key)) return true;
    if (findsInjection(inner)) return true;
  }
  return false;
}

/**
 * Why this file cannot be handed to mountebank as it stands, or null when it can.
 *
 * Only the things that are certain from reading it: not JSON, not a configuration, or
 * injection without the flag. Anything subtler is still caught by the exit handler.
 */
/**
 * Say it once, wherever the state was reached — reading the file ourselves, or watching
 * mountebank refuse it. Somebody whose mocks stopped answering needs the reason and the way
 * back in the same breath, not a stack trace.
 */
function sayStoreStranded() {
  console.error(
    [
      '',
      `  ${store.path} is NOT loaded:`,
      `    ${store.loadFailed}`,
      '',
      /injection/i.test(store.loadFailed ?? '')
        ? '  Those mocks use injected JavaScript, which is off unless asked for. Start again\n  with --allow-injection, or turn it on in Settings — one press, and they are back.'
        : '  Fix the file, or point somewhere else in Settings.',
      '',
      '  The instance is running empty. The file is untouched and nothing will be written',
      '  over it until it loads.',
      '',
    ].join('\n'),
  );
}

function whyStoreWontLoad(opts) {
  if (store.path === null || !existsSync(store.path)) return null;
  let body;
  try {
    body = JSON.parse(readFileSync(store.path, 'utf8'));
  } catch (error) {
    return `it is not JSON (${error.message})`;
  }
  if (!Array.isArray(body?.imposters)) {
    return 'it has no "imposters" array, so it is not a mountebank configuration';
  }
  if (!opts.allowInjection && findsInjection(body)) {
    return 'JavaScript injection is not allowed unless mb is run with the --allowInjection flag';
  }
  return null;
}

/**
 * The last thing mountebank complained about.
 *
 * Kept per child so a start that fails can say WHY. Its own error line is the best
 * sentence available, and "exited with code 1" is not one.
 */
function lastFailure(child) {
  const said = child.said ?? [];
  for (const line of said) {
    const match = /"message"\s*:\s*"([^"]+)"/.exec(line);
    if (match !== null) return match[1];
  }
  return said.find((line) => /error/i.test(line));
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
  /* Read it ourselves first: a file mountebank will refuse is never handed over, so the
     panel does not depend on catching a process that exits at its own pace. */
  if (store.loadFailed === null) {
    store.loadFailed = whyStoreWontLoad(opts);
    if (store.loadFailed !== null) sayStoreStranded();
  }
  const withConfig = store.path !== null && existsSync(store.path) && store.loadFailed === null;
  if (withConfig) {
    args.push('--configfile', store.path, '--noParse');
  }
  const startedAt = Date.now();
  if (opts.datadir !== null) args.push('--datadir', opts.datadir);

  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  instance = child;
  pipeChild(child);
  child.on('exit', (code) => {
    /* A restart kills it on purpose; that is not a crash to report. */
    if (child.restarting === true) return;
    /*
     * It died on the file, before ever answering. Mountebank exits rather than starting
     * empty, and taking the panel with it leaves somebody holding mocks they cannot reach
     * and no screen to fix it from. So a file it will not load becomes a reported state:
     * the instance starts without it, the file is untouched, and nothing is written over
     * it while that is true.
     */
    /*
     * Still here for what reading the file cannot predict — a duplicate port, a protocol
     * this build has no plugin for. Judged on WHEN it died rather than on whether the
     * admin port ever answered: mountebank opens that port before loading the file, so
     * "it answered" is true even when the file is what killed it.
     */
    if (code !== 0 && withConfig && Date.now() - startedAt < 20000) {
      store.loadFailed = lastFailure(child) ?? 'mountebank would not start with this file';
      sayStoreStranded();
      startMountebank(opts);
      return;
    }

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
    /* A setting the panel changed has to survive the restart, or it is not a setting. */
    opts.allowInjection = await injectionFor(opts);
    /* A flag given on the command line settles it for the machine, not just for this run:
       "I had to type it again" is the complaint this answers. */
    if (opts.injection !== null) await remember('injection', 'default', opts.injection);
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
    if (path === '/mb/instance' && req.method === 'POST') {
      void restartInstance(req, res, opts, origin, upstream);
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
            : store.loadFailed !== null
              ? `  ${label('NOT loaded')}${store.path} — running empty, see above`
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
