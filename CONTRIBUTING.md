# Contributing

## Getting it running

```bash
yarn install
yarn dev          # http://localhost:5273
```

You need a Mountebank instance to point at. If you have none:

```bash
npx @mbtest/mountebank@2.9.4 --origin "http://localhost:5273"
```

Then add an environment in the panel with `http://localhost:2525` as the admin API.
The README explains the two ways the panel reaches an instance, and why the `--origin`
flag is sometimes needed.

## Before you open a pull request

```bash
yarn check:types && yarn tests && yarn lint && yarn build
```

All four must pass. There are no exceptions for a small change, because the whole
point of the test suite is the next section.

## The one rule that matters most

**A stub must survive being opened and saved, byte for byte.**

The editor maps Mountebank's JSON to an editable model and back. If a construct is not
modelled, it is _carried_ — read into an `extras` bag and written back untouched — and
never dropped. Two silent data-loss bugs have already been caught this way: a `fault`
response read as a plain `200`, and a proxy's `injectHeaders` quietly deleted on save.

So, if you touch `src/lib/mb/model.ts`:

- add a round-trip case to `src/lib/mb/model.test.ts` for the construct you touched,
- assert on the wire JSON, not on the model,
- and if the editor cannot draw it, prove that it is carried rather than lost.

`COVERAGE.md` lists what is drawn, what is carried, and how that was verified against
the real `@mbtest/mountebank` package.

## Conventions worth knowing

- **Every size and colour comes from a token** in `src/styles/tokens.css`. No raw hex,
  no literal pixel font sizes.
- **Icon sizes are set in CSS per context**, never at the call site.
- **Comments explain why, not what.** A comment that restates the code will be removed;
  one that records a decision or a trap will be kept.
- **The panel never claims something it computed as something an instance reported.**
  Which stub answered a request is computed locally unless the instance runs with
  `--debug`, and every screen that shows it says so.

## Releasing

Versions on npm are immutable. `0.1.0` can never be republished with different
contents, and a number that has been used cannot be reclaimed — so a release is a
one-way door and the tag is what opens it.

1. Bump `version` in `package.json`.
2. Write the CHANGELOG entry.
3. Commit, then push the matching tag:

```bash
git tag v0.1.1 && git push origin v0.1.1
```

[`release.yml`](.github/workflows/release.yml) refuses to continue if the tag and
`package.json` disagree, runs the same four checks as CI, and publishes.

There is no npm token in this repository. The workflow authenticates over OIDC —
npm's trusted publishing — which the package has configured on npmjs.com against
this repository and that filename, so **renaming the workflow file stops publishing
working** until npmjs.com is updated to match. Each published version carries
provenance: a signed statement of the commit and workflow that built it.

## Licence and contributions

The project is Apache-2.0. By opening a pull request you agree that your contribution
is licensed under the same terms (Apache-2.0, section 5). Please do not paste code you
do not have the right to relicense.
