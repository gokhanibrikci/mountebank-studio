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
import { readyToRoute } from './lib/mb/reach';
import { useEnvironments } from './store/useEnvironments';
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
 * A first run served by `npx mountebank-studio` gets its environment from the host
 * that served it, so the panel opens on a working instance instead of an empty
 * welcome. Nothing is adopted when this browser already has a list of its own.
 */
useEnvironments.getState().seed(await seedFromHost());

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
