# Changelog

## 0.1.8 — 19 August 2026

- **The welcome screen says what is true of the host serving it.** Two blocks still sent
  people to add `--origin` to an instance, which 0.1.5 and 0.1.7 made unnecessary: served
  by its own server, the panel has that instance fetched for it. Served that way, *If an
  instance refuses this page* now explains that no flag is involved anywhere, and the start
  command drops `--origin` — with a line saying why it is missing. Served as a static build
  or by `yarn dev`, where nothing can forward, the original advice is exactly right and is
  unchanged. Both readings were checked in a browser against a host of each kind.
- **It stops asking a question it can see the answer to.** *No Mountebank running yet?* is
  the heading only when nothing is listed; with an instance already there it reads
  *Starting another one*, and the command is described as starting a second on a port of
  its own.

## 0.1.7 — 19 August 2026

- **An instance that refuses this page is now reached without being asked twice.** 0.1.5
  put an offer in the error — *Reach it through this host* — and a link inside a paragraph
  is easy to read past, especially when the block around it looks like the failure you
  already know. Pointing an environment at an instance was the request; arranging the route
  is how it gets carried out, so the panel does it and says so in a toast. The link stays
  for the case where the host says no.
- **Mountebank's `error:` and `warn:` lines are no longer thrown away.** Its log goes to
  stdout and this server ignored that stream entirely, so a genuine complaint from the
  instance vanished along with the "now taking orders" chatter. Those two levels come
  through; the rest stays quiet, because the banner already says the version and the port.
- **The punycode deprecation warning is dropped.** Mountebank supports an smtp imposter, so
  it depends on smtp-server, mailparser and nodemailer, and those require Node's deprecated
  built-in `punycode`; Node 21 and later print it on every start. Nobody reading it can act
  on it. Every other line, including any other deprecation, still comes through — and each
  line is labelled now, rather than only the first of a chunk.

## 0.1.6 — 19 August 2026

- **An environment saved from the form records that it is read through this host whenever
  it is** — not only when that test is what arranged it. A route registered earlier, by
  another environment or an earlier session, left the environment saved without the mark,
  so a restart made it fail once before the offer appeared again. Who registered the route
  first has no bearing on what the panel needs to know afterwards.

## 0.1.5 — 19 August 2026

**Adding an environment is now enough, even for an instance that refuses this page.**

Until now the panel could only report that failure. The instance is up, it does not allow
this origin, and `--origin` belongs to whoever runs it — so the advice was to change
something the person reading it often cannot change. The only way through was to restart
this server with `--mb-url`, which meant knowing about a flag before adding an
environment, and made the environment list pointless in that mode.

The host serving the panel can fetch that instance perfectly well, and a request that
leaves from this origin is not cross-origin at all. So it will now be asked:

- **In the form.** Paste the URL, press *Test Connection*, and a blocked instance is
  arranged rather than reported: the verdict reads *read through this host, which now
  forwards to it at …*, and saving records how it is reached.
- **In the error.** An environment you already have offers *Reach it through this host*
  the first time a read fails. One press and the read succeeds.

Three things this deliberately does not do. It does not rewrite the address you typed —
that records where the instance **is**, and the route is worked out from what the host
publishes at `/mb/targets.json`. It does not keep forwards in a file: the host holds them
in memory, and the panel remembers which environments were reached that way and asks again
after a restart, so the arrangement outlives the process without state nobody can find.
And it does not offer any of this when the panel is bound to a network with `--host` — an
endpoint that makes this server fetch whatever URL it is handed would be a proxy for
whoever can reach it. Registration also refuses a URL that is not http(s), credentials in
a URL, and a request from another site.

## 0.1.4 — 19 August 2026

- **`--mb-url https://…` works.** The forward was built on `node:http` whichever
  protocol the target used, so an https upstream closed the socket instead of answering
  — an empty reply, with nothing in the log to explain it. The module is chosen by the
  target's protocol now, and a default port comes from that module rather than from a
  guess. This is the flag's main case: a Mountebank somebody else deployed, behind TLS,
  that you cannot add `--origin` to. Verified against a real staging instance whose
  `/config` reports no origin allowlist at all — proof the request went through the
  forward, since a direct call from this origin could not have been read.
- **`--insecure`** skips TLS verification for that upstream, for a certificate that
  cannot be fixed. Off by default, and the banner says so while it is on.
- **An environment named after where it points.** With `--mb-url` the published
  environment was still called *Local*, so the sidebar called a staging instance local on
  every screen. It carries the upstream's host now.

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
