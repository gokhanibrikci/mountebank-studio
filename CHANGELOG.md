# Changelog

## 0.1.3 — 19 August 2026

Two faults with one cause: the panel decided all-or-nothing what to take from the host
that served it.

- **The instance your own command started is no longer hidden.** `npx mountebank-studio`
  publishes the environment that reaches the Mountebank it starts, but the panel adopted
  that list only when the browser had none of its own. Anyone who had used the panel
  before therefore opened on whatever they last had — in one report a staging instance
  this host neither forwards nor can reach, so the first screen was an error while the
  working instance sat unlisted at `/mb/local`. Same origin, same storage: `yarn dev` and
  the published server both answer on 5273, so the two lists were never separate.

  A published environment is **added** now, beside what is already there, and never
  twice. The ids a host has offered are recorded, so removing one is a decision that
  holds rather than an argument with the next restart. An id or a target already in the
  list is left alone, and nothing anybody typed is edited or dropped.

- **The welcome screen is met once.** It was skipped whenever an environment existed,
  which meant the screen explaining what a mock is made of — and how to stand an instance
  up — was seen by nobody who took the one-command route. It now opens on the run that
  adopts an environment, with that environment already listed, so it costs a press of
  **Start** rather than anything typed. Whether it has been seen is remembered across
  sessions and settled by Start, not by the screen appearing: a tab closed halfway
  through means nobody has read it yet.

The adoption rule is a pure function with eight tests, and the wiring was driven in
Chrome across the four states it has — a fresh browser, a returning one that never
pressed Start, one that has, and one whose environment the user removed.

## 0.1.2 — 19 August 2026

Documentation and two details of presentation. Nothing in how the panel talks to a
Mountebank has changed.

- **The README answers three questions a first run actually raises.** How to install it
  rather than fetch it on every run; how to pin one version for a team, as a development
  dependency with a script — and where that has to be run, since `npm run` outside a
  project answers `ENOENT ... package.json` and says nothing about why; and what a
  restart forgets. Mountebank keeps imposters in memory, so the instance started for you
  is empty every time: the way to keep what you built is to copy **Settings → Full
  configuration** and start Mountebank yourself with `--configfile`. That recipe was run
  before it was written.
- **The banner keeps one column.** `Using your instance` is four characters longer than
  `Started for you`, and with a fixed gap after the label the URL moved with it.
- **The independence line in Settings uses the width of its card**, instead of stopping
  short of it while every row above ran to the edge.

## 0.1.1 — 18 August 2026

- **`npx mountebank-studio` installs 24 MB instead of 44 MB.** React, React DOM,
  axios, zustand, the router and React Query were listed as runtime dependencies,
  but the browser bundle compiles them into `dist/` at publish time and nothing
  reads them afterwards — `server/index.mjs` imports only Node's own modules. They
  are development dependencies now, so the only thing installed alongside the panel
  is Mountebank itself: 183 packages rather than 207. Measured, not assumed: the
  tarball was installed into an empty directory and the panel served, wrote an
  imposter and got an answer back with none of those packages present.
- **Settings now says what the panel itself is** — a *This panel* block with its own
  version, its licence, a link to the source, and the line stating that this is an
  independent project. The version is there because the first question on any bug
  report is which one you are running, and until now the panel could only answer for
  the Mountebank it was pointed at.
- **CI** — types, tests, lint and build on Node 20 and 22, plus a smoke test that
  starts the published entry point and proves the panel is served, a write reaches the
  instance through the forward, and the shipped defaults are still injection-off and
  loopback-only.

## 0.1.0 — 18 August 2026

The first release. A visual console for [Mountebank](https://www.mbtest.dev/): its
imposters, their stubs, the responses those stubs give, and the traffic each imposter
captured — none of it hand-written as JSON.

```bash
npx mountebank-studio
```

One command starts a Mountebank, serves the panel and forwards to the instance, so the
panel and the instance share one origin and no `--origin` flag is involved anywhere.

### What it does

- **Imposters** — create, duplicate, delete; ports, protocols, recording, TLS fields,
  a default response, and a raw JSON view of the whole definition.
- **Stubs** — a plain form for method, path, query, headers and body, or the full
  predicate editor with `and`/`or`/`not` groups, `deepEquals`, `exists`, jsonpath
  selectors and case sensitivity. Values carry an explicit JSON type, because
  Mountebank compares by type and a digits-only reference must stay a string.
- **Responses** — canned replies, proxy recording in all three modes, injected
  JavaScript, and **faults** that break the connection instead of answering. Delays,
  behaviors and response cycling included.
- **Traffic** — every request an imposter recorded, with the stub that answered it and
  a drawer explaining why it matched.

### Two things it refuses to do

- **It does not lose what it cannot draw.** Constructs the editor has no field for — a
  proxy's injected headers, a tcp imposter's `mode`, an unknown behavior — are carried
  and written back byte-identically. Round-trip tests assert it.
- **It does not present a guess as a fact.** Mountebank reports which stub answered
  only with `--debug`, so the panel evaluates the predicates itself and labels the
  result as computed. When a read fails, it repeats the request as `no-cors` to tell a
  refused origin apart from a dead host rather than offering a list of maybes.

### Verified against mountebank 2.9.1

Feature by feature, read from the package's own source rather than its documentation:
see [COVERAGE.md](COVERAGE.md).

### Notes

- Apache-2.0.
- Unofficial: not affiliated with or endorsed by the mountebank project. Mountebank is
  MIT-licensed and is not redistributed here — it is a dependency the bundle starts for
  you, bound to loopback with injection off.
