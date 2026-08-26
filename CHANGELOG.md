# Changelog

## 0.4.3 — 26 August 2026

- **The instance this command starts is simply listed, every start.** Two releases went into
  offering it, which was the wrong shape for the question: `mountebank-studio` starts a
  Mountebank and serves it at `/mb/local`, and a panel that does not list it opens on
  something else while the working instance sits unlisted. That is not a preference to
  remember — it is what the process is. Everything else a host publishes still asks once, so
  removing a shared environment is still a decision that sticks. The offer strip is gone with
  its own explanation, and adoption compares by instance, so a list that already has the
  address from the terminal does not gain a second row for the same Mountebank.
- **An environment can no longer be pointed at this page.** The easiest mistake available:
  the panel and the instance are both on 127.0.0.1, both printed by the same command, and the
  panel answers — with `index.html`, for every path, because a single-page app has to. So it
  looked alive and read nothing, and Settings crashed on it before 0.4.1. The form refuses its
  own origin now and says where the instance actually is. A path (`/mb/local`) and any address
  under a path on this origin are untouched, since sharing a hostname behind a proxy is
  ordinary.

## 0.4.2 — 26 August 2026

- **The offer added in 0.4.1 no longer offers an instance you already have.** It compared
  address *strings*: the host publishes `/mb/local`, while somebody who typed the address
  from their own terminal has `http://127.0.0.1:2525`. One Mountebank, two spellings, so
  the panel offered the instance it was already connected to — and accepting would have
  made a second row for it. Sameness is decided by instance now, through the same
  `resolveTarget` the panel uses to route requests, and `localhost`, `127.0.0.1` and
  `[::1]` count as one machine wherever that question is asked: reaching an instance,
  registering a forward, and this offer.
- **And it says what it means.** "This host runs one of its own" explained nothing. Now:
  *the Mountebank this page serves is not in your list — this page already reaches one at
  /mb/local, the instance the terminal named when it started. Nothing in the list below
  points at it, so the panel opens on something else.*

## 0.4.1 — 19 August 2026

- **Settings no longer crashes when an environment is not a Mountebank.** `GET /config` was
  believed on sight, so any address answering 200 with something else — the panel's own URL,
  which serves index.html for every path; an imposter's port; a gateway — reached the screens
  as a successful config and Settings died on `options.configfile` with a white page and
  `Cannot read properties of undefined`. The body is checked at the boundary now, which is the
  one place that can make the type true, and a body that is not a config becomes a failed read
  with a sentence to act on: *that address answered, but not with a Mountebank configuration —
  check that it points at an instance's admin port, not at an imposter, and not at this page.*
- **The instance this host runs can be added back.** An environment removed once is not handed
  back on every start, and that stays — but "never again, with no way back" was a dead end,
  since the only route left was typing an address the host already knows. Settings now offers
  it once, in the Environments section: *this host forwards to a Mountebank at /mb/local, and
  it is not in your list — Add it.*

## 0.4.0 — 19 August 2026

**The imposters you create are kept.** Mountebank holds them in memory unless it is told
otherwise, so until now closing the terminal threw away everything built in the session —
with nothing on screen saying it would. For a panel whose job is building mocks by hand, that
was the wrong default.

The instance started for you now gets a directory, and the banner says which:

```
  Imposters kept in        ~/.mountebank-studio/local-2525
```

Close it, start it again, and they are there — verified in CI by an actual restart rather than
by the presence of a file.

- The path is under your home rather than the working directory, because "where I ran it from"
  is not something anyone remembers, and it is keyed by the mountebank port: `--mb-port 3000`
  is a different instance and gets its own store.
- **`--datadir <path>`** puts it anywhere — a project directory, if these mocks belong to a
  repository.
- **`--memory`** opts out for a throwaway session, and the banner says *Not kept* instead, out
  loud, because that is the case where closing the window loses work.
- Nothing is kept for an instance you point at with `--mb-url`: that one is yours, and how it
  persists is its own business.

Every call the panel makes was re-checked against a datadir-backed instance before this became
the default — the filesystem-backed repository is a different code path in mountebank, and all
twelve answer identically, recorded traffic included.

## 0.3.2 — 19 August 2026

- **Saving an edited stub works.** It never had: `PUT /imposters/:port/stubs/:index` was sent
  as `{ stub: … }`, and mountebank reads that endpoint's body as the stub itself, so every
  save came back `400 'responses' must be a non-empty array` — mountebank had read the
  wrapper and found no responses in it. The three stub endpoints do not agree on their
  envelope, and only mountebank's source says so:

  | endpoint | body |
  | --- | --- |
  | `POST /imposters/:p/stubs` | `{ stub, index }` |
  | `PUT /imposters/:p/stubs/:index` | the stub, bare |
  | `PUT /imposters/:p/stubs` | `{ stubs }` |

  Driven through the panel against a live instance: the request now carries the bare stub, the
  predicate changes, and the imposter answers on the new path. CI asserts all four shapes —
  including the two refusals — against a running instance, because nothing but a running
  instance can catch this.

- **The demo agreed with the bug.** It accepted `{ stub }` on that endpoint and accepted stubs
  with no responses, both of which a real instance refuses — a demo that agrees with a bug
  hides it. It now enforces mountebank's rule, in mountebank's words.

- **Import says so before writing.** A stub whose `responses` is missing, not an array, or
  empty is refused by mountebank and takes its whole imposter down with it, so the file is
  reported rather than half-written.

## 0.3.1 — 19 August 2026

- **Importing with *Replace everything* now asks twice, and names what it will delete.** One
  press on a radio and one on a button was enough to empty an environment other people may be
  using, with the explanation sitting above the button rather than in it. The first press turns
  the button into *Yes, delete 2 imposters and replace* over a line naming them by name. The
  other mode — *Add, replacing by port* — is unchanged and still touches only the ports the
  file mentions.
- **A whole-config write says what it removed.** The toast counted what arrived and left the
  deletion to be discovered later; it now reads `4 imposters written · 2 imposters removed
  (7101, 7102)`.

## 0.3.0 — 19 August 2026

- **Imposters can be read in from a file, not only written out.** *Imposters → Import JSON*
  takes the document *Settings → Full configuration* shows — mountebank's `--configfile`
  shape — and the two variants people actually have on disk: a bare array, and a single
  imposter.

  Nothing is sent until it is understood. The file is parsed as it is pasted or chosen, and
  the screen says what will happen before the button is pressed: which ports get created,
  which get replaced, and what in the file is unusable and why, line by line. A bulk write
  that turns out to be half a write is the worst outcome available here.

  Two ways in, and the difference is said in ports rather than adjectives. **Add, replacing
  by port** creates everything in the file, replaces an imposter whose port is already
  running, and leaves anything the file does not mention alone — what a config file in a
  repository is for. **Replace everything** makes the file the whole environment and names
  the imposters it will delete. A partial failure reports what did land and which port
  refused, rather than a toast that says "imported" over half a write.

- **A demo that needs nothing installed** — <https://gokhanibrikci.github.io/mountebank-studio/>.
  The panel itself, with the admin API answered from inside the browser tab, so a link is as
  good as an install for a first look. Every screen is the code that talks to a real
  instance; only the transport is swapped, at the adapter. It says on every screen that
  nothing is listening.

- **Depends on `@mbtest/mountebank` 2.9.4 instead of `mountebank` 2.9.1.** They are the same
  project: mountebank moved to the mountebank-testing organisation in 2025 and renamed as it
  went. The old name on npm stopped at 2.9.1, published August 2023, and 2.9.2–2.9.4 are
  three releases of dependency security updates — which is what the CVE reports against
  mountebank are about. `npx mountebank-studio` now installs the maintained build.

  The old package is still accepted, second, for anyone whose environment already has it: the
  admin API is the same either way and refusing to start over a package name would help
  nobody. All three paths were checked from the packed tarball — both installed picks 2.9.4,
  only the old one falls back to 2.9.1, neither gives an error that names what to install.

  Every call this panel makes was re-checked against a live 2.9.4 instance before the switch:
  `/config` and its `options.origin`, both list views, the imposter and stub sub-resources,
  and the two sweeps all answer in the same shapes.

## 0.2.1 — 19 August 2026

- **The Postman download moved to the Imposters page header**, beside *New Imposter* and
  *Save Config*. It shipped in Settings, under Maintenance, four rows down and a scroll
  below the fold — where the person who asked for it could not find it. Reading the mocks
  back out belongs next to the list of them, which is where anyone looks for "export all of
  this". It is gone from Settings: one action, one place.

## 0.2.0 — 19 August 2026

### The mocks, as a Postman collection

**Settings → Postman collection → Download.** Every imposter becomes a folder, every stub
a request that satisfies it, and the host is a variable so one file follows the instance
from a laptop to a shared box.

A stub is a condition and a request is one instance of it, so the translation is lossy —
and every request says how. A `startsWith` path is one path that fits it. A `not(…)` cannot
be a request at all and is left out. An `or` contributes its first branch. `exists` names a
field without a value. Each of those is written into the request's own description, because
a request that quietly fails to match the stub it came from would be worse than none.

One thing it reports that only the panel could know: **which stub will actually answer.**
Satisfying a stub's conditions is not the same as being reached by it — Mountebank takes
the first stub that fits, so a broader stub above answers instead. Found by firing an
exported collection at a real imposter, where a POST written from stub 2 came back with
stub 1's 404. The panel evaluates the request against the whole list and says so:

> Stub 1 also fits this request and, being higher in the list, is the one that answers it.
> Narrow that stub, or move this one above it, to reach this stub.

`tcp` and `smtp` imposters are left out — Postman has no URL to send to — and the count
that was left out is reported rather than silently dropped.

### The imposter screen

- **Edit**, in the header, opens Settings — where its name, port, protocol and default
  response live. A tab strip below the fold was not where anyone looked for that.
- **The JSON tab is gone, and its editor is inside Settings**, above Default response.
  Editing the fields and editing the JSON are two ways at one object; as separate tabs each
  hid the other.
- **Save Changes and Revert moved to the right of their row**, after the sentence saying
  what saving will do. The buttons came first and the consequence trailed them.
- **Default response has room to be read** — it held about four lines, which a status and a
  one-line body already overflowed.
- **An invalid-JSON message no longer moves the buttons.** It shared a wrapping row with
  them, so a parser message pushed *Replace Imposter from JSON* onto its own line. The
  message has a line of its own now, where the part that matters — `line 49 column 28` — is
  read whole rather than truncated.

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
