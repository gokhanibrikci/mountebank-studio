/**
 * Entry point.
 *
 * Three providers and nothing else: the query cache, the router, and the app.
 * `base.css` is imported here — once, at the root — because it carries the
 * design tokens every component module reads with `var(--…)`.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { seedFromHost } from './lib/environments';
import { DEMO_BUILD, DEMO_TARGET } from './lib/demo/instance';
import { readyToRoute, resolveTarget, restoreForwards } from './lib/mb/reach';
import { useEnvironments } from './store/useEnvironments';
import { useStudio } from './store/useStudio';
import './styles/base.css';

/**
 * `retry: 1` because a mountebank that is down is down: one retry absorbs a
 * dropped connection without making an unreachable environment take four
 * round-trips to admit it. Per-query `staleTime` is set in lib/queries.ts.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('index.html is missing its #root element');

/*
 * One same-origin request before the first render: which instances this host
 * forwards, if any. It has to be known BEFORE a client is built, or the first
 * fetch of a session would go out directly and fail for CORS on an instance the
 * host was perfectly able to forward. It never rejects — no manifest simply means
 * every target is called directly.
 */
await readyToRoute();

/*
 * A first run served by `npx mountebank-studio` gets its environment from the host that
 * served it, so nobody has to type an address it already publishes. It is ADDED even when
 * this browser has a list of its own — the rule that said otherwise was the bug — and
 * skipped only when the instance is already listed, or was offered once before. The one
 * exception is the instance this host serves, which is listed on every start: that is not
 * a preference, it is what the process is.
 *
 * Adopting one still opens the welcome, once. Landing straight in the shell meant the
 * screen explaining what a mock is made of — and how to stand an instance up — was seen
 * by nobody who took the one-command route. The environment is listed there as a row,
 * so it costs a press of Start rather than anything typed.
 */
/*
 * Forwards the user arranged before are asked for again, since the host keeps them in
 * memory and `npx` restarts often. After the manifest, so anything already published is
 * free; before the first render, so the first read of the session takes the right route.
 */
await restoreForwards(
  useEnvironments
    .getState()
    .list.filter((env) => env.forwarded === true)
    .map((env) => env.target),
);

/*
 * The demo build carries its own environment and skips the welcome. Somebody arriving from
 * a link was promised the panel, not a form; the banner above every screen says what they
 * are looking at, which the welcome could only say once.
 */
if (DEMO_BUILD) {
  useEnvironments.getState().seed([{ id: 'demo', label: 'Demo', target: DEMO_TARGET }]);
  useStudio.getState().setGreeted(true);
}

/*
 * An environment naming this page rather than an instance is dropped, and the drop is
 * announced. It is the panel's own address in a list of Mountebanks: it answers every path
 * with index.html, so it looks alive and reads nothing. Kept, it is a row that can only
 * ever fail; gone quietly, it is data that vanished. So it goes, and it says so.
 */
const dropped = useEnvironments.getState().dropOwnAddress();
for (const env of dropped) {
  useStudio
    .getState()
    .toast(`Removed ${env.label} — ${env.target} is this page, not a Mountebank.`, 'warn');
}

/* resolveTarget, so an instance already in the list under the address somebody read off
   their terminal is not adopted a second time under the path this host publishes. */
const adopted = useEnvironments.getState().seed(await seedFromHost(), resolveTarget);
if (adopted && !useStudio.getState().greeted) useStudio.getState().setWelcome(true);

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* BASE_URL so the same build works at a domain root and under a project path,
        which is where GitHub Pages serves it from. */}
    <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
