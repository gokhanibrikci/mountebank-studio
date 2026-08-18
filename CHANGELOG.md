# Changelog

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
