# What this panel covers of Mountebank

> **Which mountebank.** This panel depends on **`@mbtest/mountebank`**, the package the
> mountebank-testing organisation publishes — currently 2.9.4. The older `mountebank` name
> on npm stopped at 2.9.1 in August 2023, before the project changed hands, and carries the
> dependency advisories that 2.9.2–2.9.4 fixed.
>
> The tables below were written against the 2.9.1 source, and every call this panel makes
> was re-checked against a live 2.9.4 instance: `/config` (its `options.origin` included),
> both list views, the imposter and stub sub-resources, and the two sweeps all answer in the
> same shapes. Where a version matters to a claim, the claim says so.

Read off the real thing, not from memory: the feature list comes from the
`mountebank@2.9.1` source (`src/models/predicates.js`, `behaviors.js`,
`responseResolver.js`, `mountebank.js` routes, the protocol servers) and the panel
column comes from `src/lib/mb/{types,model,client}.ts` and the screens that bind to
them.

Three words are used precisely:

|               | meaning                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Visual**    | there is a control for it; you never type JSON                                                                                             |
| **JSON only** | not modelled, but survives — write it in the JSON view (per stub, or the imposter's whole JSON tab) and the panel round-trips it untouched |
| **Carried**   | not drawn, but never touched: read into the model, written back byte-identically, editable in the JSON view                                |

---

## Protocols

| Mountebank                                 | Panel                             |
| ------------------------------------------ | --------------------------------- |
| `http`                                     | **Visual**                        |
| `https` — plus `key`, `cert`, `mutualAuth` | **Visual**                        |
| `tcp`                                      | **Visual** (creation and listing) |
| `smtp`                                     | **Visual** (creation and listing) |
| `tcp` `mode: text \| binary`               | **Carried** (JSON view)           |
| `tcp` `endOfRequestResolver`               | **Carried** (JSON view)           |
| Custom protocols (`--protofile`)           | Not addressed                     |

The panel is protocol-agnostic where it can be: an imposter of any protocol is
listed, opened, duplicated and deleted. The request/response editors are written
around HTTP fields (method, path, query, headers, body), which is what a tcp or smtp
imposter does not have — those are editable through JSON.

---

## Imposter fields

| Mountebank                                           | Panel                                                  |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `port`, `protocol`, `name`                           | **Visual**                                             |
| `recordRequests`                                     | **Visual** (toggle, with the state shown on the list)  |
| `defaultResponse`                                    | **Visual** (JSON field)                                |
| `stubs`                                              | **Visual**                                             |
| `key`, `cert`, `mutualAuth` (https)                  | **Visual**                                             |
| `numberOfRequests`, `requests`, `_links` (read-only) | Read and displayed; never written back                 |
| Anything else on an imposter                         | **Carried** — including a custom protocol's own fields |

---

## Predicates

| Mountebank                                                                        | Panel                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `equals`, `deepEquals`, `contains`, `startsWith`, `endsWith`, `matches`, `exists` | **Visual**                                                                                             |
| `and`, `or`, `not` groups, nested                                                 | **Visual**                                                                                             |
| Several fields in one predicate (`{equals:{method,path}}`)                        | **Visual** — and deliberately: splitting them would turn an AND into an OR inside `or`                 |
| Value types (`"42"` vs `42` vs `true` vs object)                                  | **Visual** — an explicit `str · num · bool · json` chip per value, because Mountebank compares by type |
| `caseSensitive`                                                                   | **Visual**                                                                                             |
| `jsonpath` selector                                                               | **Visual**                                                                                             |
| `xpath` selector (and `ns`)                                                       | **JSON only**                                                                                          |
| `except`                                                                          | **JSON only**                                                                                          |
| `keyCaseSensitive`                                                                | **JSON only**                                                                                          |
| `inject` (a predicate function)                                                   | **JSON only**                                                                                          |
| Fields: `method`, `path`, `query`, `headers`, `body`                              | **Visual**                                                                                             |
| Fields: `data` (tcp), `form`, `requestFrom`, `ip`                                 | **JSON only**                                                                                          |

A predicate the visual editor cannot represent is kept whole and written back
verbatim (`RawPred`), and the plain form lists it as an extra rule rather than
pretending it is not there. So the predicate side has no data-loss holes.

---

## Responses

| Mountebank                                                                                                                   | Panel                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `is` — `statusCode`, `headers`, `body`                                                                                       | **Visual**                                                              |
| `is` — `_mode: text \| binary`, tcp's `data`                                                                                 | **Carried** (JSON view)                                                 |
| `proxy` — `to`                                                                                                               | **Visual**                                                              |
| `proxy` — `mode`: `proxyOnce`, `proxyAlways`, `proxyTransparent`                                                             | **Visual**                                                              |
| `proxy` — `predicateGenerators` on method/path/query/body                                                                    | **Visual** (checkboxes)                                                 |
| `proxy` — `addWaitBehavior`, `addDecorateBehavior`                                                                           | **Visual**                                                              |
| `proxy` — `predicateGenerators` with `caseSensitive`, `except`, `xpath`, `jsonpath`, `ignore`, `inject`, `predicateOperator` | **Carried** (the checkboxes own `[0].matches` only)                     |
| `proxy` — `injectHeaders`, `key`, `cert`, `passphrase`                                                                       | **Carried** (JSON view)                                                 |
| `inject` (a response function)                                                                                               | **Visual** (code editor; the instance must run with `--allowInjection`) |
| `repeat`                                                                                                                     | **Visual**                                                              |
| **`fault`** — `CONNECTION_RESET_BY_PEER`, `RANDOM_DATA_THEN_CLOSE`                                                           | **Visual** — _Break the connection_, with both values                   |
| Multiple responses per stub, cycled                                                                                          | **Visual**                                                              |

---

## Behaviors

Mountebank 2.x takes behaviors as an array, which is the form the panel writes.

| Mountebank                 | Panel                             |
| -------------------------- | --------------------------------- |
| `wait` (ms, or a function) | **Visual**                        |
| `decorate`                 | **Visual**                        |
| `copy`                     | **Visual** (value as JSON)        |
| `lookup`                   | **Visual** (value as JSON)        |
| `shellTransform`           | **Visual**                        |
| An unknown behavior name   | **Carried**, after the drawn ones |

`copy` and `lookup` have rich sub-structures (`from`, `into`, `using`, `fromDataSource`);
the panel gives them one JSON value field rather than a form of their own.

---

## Admin API

| Endpoint                                                     | Panel                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `GET /imposters`                                             | ✅ (merged with `?replayable=true`, because one carries counts and the other carries stubs) |
| `GET /imposters/:port`                                       | ✅                                                                                          |
| `POST /imposters`                                            | ✅ (New Imposter, Duplicate)                                                                |
| `DELETE /imposters/:port`                                    | ✅                                                                                          |
| `PUT /imposters`                                             | ✅ (Save Config — replaces the whole set)                                                   |
| `DELETE /imposters`                                          | ➖ not offered (deleting everything at once has no screen)                                  |
| `POST /imposters/:port/stubs`                                | ✅ (add a stub, at an index)                                                                |
| `PUT /imposters/:port/stubs/:index`                          | ✅ (edit a stub)                                                                            |
| `DELETE /imposters/:port/stubs/:index`                       | ✅                                                                                          |
| `PUT /imposters/:port/stubs`                                 | ✅ (reorder)                                                                                |
| `DELETE /imposters/:port/savedRequests`                      | ✅ (Clear captured requests)                                                                |
| `DELETE /imposters/:port/savedProxyResponses`                | ✅ (Clear saved proxy responses)                                                            |
| `GET /config`                                                | ✅ (version, flags, uptime, the CLI line)                                                   |
| `GET /logs`                                                  | ❌ **not surfaced** — see below                                                             |
| `POST /imposters/:port/_requests` (+ `/:proxyResolutionKey`) | ❌ not surfaced (proxy resolution / replay injection)                                       |
| `GET /metrics` (Prometheus)                                  | ❌ not surfaced                                                                             |
| `GET /feed`, `/releases`, `/sitemap`                         | ➖ Mountebank's own website, not API                                                        |

### The two API gaps worth knowing

**`GET /logs`.** Mountebank's own log, including the line that says which stub
matched when the instance runs with `--debug`. The panel does not read it: the
Activity screen is built from each imposter's recorded requests, and which stub
answered is **computed** locally by re-evaluating predicates (`src/lib/mb/match.ts`),
labelled as computed everywhere it appears. That is why recording has to be on for
Activity to show anything.

**Proxy resolution.** Recording a real service through `proxyAlways` and then
replaying it is supported to the extent that proxy responses are saved on the
instance and can be cleared from Settings — but the `_requests` endpoints, which
let a client resolve a pending proxy call, have no screen.

---

## CLI flags (the instance's own, reported not set)

The panel never starts an instance. It reads what `GET /config` reports and shows
it: `--port`, `--configfile`, `--allowInjection`, `--localOnly`, `--ipWhitelist`,
`--mock`, `--debug`, `--origin`, and reconstructs the command line from exactly
those. `--apikey` is reported by the instance but the panel cannot send a key, so an
instance started with one is unreachable from here.

---

## What this audit found, and what was done about it

The first version of this audit listed three ways the visual editor could silently
rewrite a stub. All three are closed, and each is covered by a round-trip test in
`src/lib/mb/model.test.ts`:

| Was                                                                                                                                      | Now                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`fault` was read as `is` 200** — a connection-reset mock became a success mock on save                                                 | `fault` is a **first-class response kind**: _Break the connection_ in the editor, with the two values Mountebank defines. Behaviour rows are hidden for it, because Mountebank runs none |
| **Proxy options outside the drawn six were dropped** (`injectHeaders`, mutual-auth `key`/`cert`, `predicateGenerators` beyond `matches`) | Carried verbatim. The four checkboxes own `predicateGenerators[0].matches` and nothing else; further generators and every other key survive                                              |
| **tcp `mode` and `endOfRequestResolver` were dropped** by any imposter-level write                                                       | Carried verbatim, while the read-only fields Mountebank rejects (`_links`, `requests`, `numberOfRequests`) are still never sent back                                                     |
| _(found while fixing)_ **a tcp reply gained `statusCode: 200`** it never had                                                             | A status is written only when there was one                                                                                                                                              |

The mechanism is the same at every level and is the one the predicate side already
used: read the keys the editor draws into the model, keep the rest in an `extras`
bag, and write the drawn keys first and the carried keys after — so key order
survives too, and a saved stub is **byte-identical** to what was read.

Verified against a live instance holding a `CONNECTION_RESET_BY_PEER` stub, a
`RANDOM_DATA_THEN_CLOSE` stub with `repeat`, and a `proxyAlways` stub with
`injectHeaders`: all three round-trip byte-identically through the editor's own
model.

So the honest statement now is: **nothing in the table above is lost.** What the
editor cannot _draw_ is listed as **JSON only** — you edit it in the JSON view, and
it survives everything else you do.
