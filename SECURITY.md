# Security

## Why this file exists

This panel edits mock servers, and mocks decide what a system under test believes.
Someone who can change a stub can make a payment integration "succeed" in a test that
would fail in production. That makes a bug here worth reporting properly.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub's
**Security → Report a vulnerability** form on this repository, or by email to the
address in `package.json`.

Tell me what you did, what happened, and what you expected. A proof of concept helps.
I will acknowledge within a few days and tell you plainly whether I can fix it and
when.

## What is in scope

- The panel writing something to an instance that the user did not ask for.
- The panel losing or silently rewriting a stub. This has happened before and is
  treated as a serious bug, not a cosmetic one — see COVERAGE.md.
- Anything that leaks an environment's address or credentials outside the browser.
- Cross-site scripting through a stub body, a recorded request or an imposter name.

## What is not a vulnerability

These are documented behaviours, not flaws:

- **Mountebank's admin API has no authentication of its own.** Anyone who can reach
  it can change the mocks, with or without this panel. Protect the port.
- **A forwarded `/mb/*` path is an open door.** Whoever can reach it can rewrite those
  mocks with none of the instance's own network restrictions in the way. Put the panel
  and its forwarding paths behind your usual authentication.
- **`--allowInjection` runs JavaScript from stub definitions.** That is Mountebank
  executing code you gave it, by design. The panel reports whether an instance allows
  it.
- **`--origin` is a browser rule, not access control.** Anything that can reach an
  instance over the network can call its API regardless.

## Where secrets live

Environments are kept in the browser's `localStorage`, never on a server and never in
the build. `.env.local` is git-ignored. If you find a real host name or a credential
committed to this repository, that is a bug worth reporting under the section above.
