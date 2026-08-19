/**
 * The shell and the routing.
 *
 * THE ENVIRONMENT LIVES IN THE URL — `/orders/imposters/4545`, not a hidden
 * setting. That is what makes a link land whoever opens it on the same imposter
 * of the same Mountebank, and it is why every query key downstream is namespaced
 * by environment: two instances can never be mixed together.
 *
 * The URL is the source of truth and the store follows it, never the reverse:
 * `Shell` syncs `:env` into `useStudio()` on mount and on every change, and an
 * environment nobody has defined is redirected rather than rendered.
 *
 * ENVIRONMENTS ARE RUNTIME DATA. The list is the user's own, kept in this
 * browser, and it starts EMPTY and can change while the app is open — so the
 * routing has three states, not one:
 *
 *   nothing defined  every route answers with <FirstRun />, URL untouched, and
 *                    `/settings` still resolves because that is where the first
 *                    environment is added.
 *   `/`              the environment the visitor last worked in, if it still
 *                    exists; otherwise the first one in the list.
 *   `/:env/…`        an unknown `:env` redirects to the first environment and
 *                    KEEPS the rest of the path, so a stale bookmark still lands
 *                    on the screen it was pointing at.
 *
 * Two contracts the screens rely on, both expressed as search params so they
 * survive a reload and can be linked to:
 *
 *   ?new=imposter   on /:env/imposters        → open the new-imposter modal
 *   ?new=stub       on /:env/imposters/:port  → open a blank stub editor
 *   ?stub=<index>   on /:env/imposters/:port  → open that stub's editor
 *
 * The topbar's primary action and the command palette both navigate with those,
 * which keeps the shell from having to reach into a screen's internal state.
 */

import { useEffect, useRef } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';

import { CommandPalette } from './components/CommandPalette';
import { DemoBanner } from './components/DemoBanner';
import { DEMO_BUILD } from './lib/demo/instance';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import type { EnvId, MbEnvironment } from './lib/environments';
import { useEnvironments } from './store/useEnvironments';
import { useStudio } from './store/useStudio';
import styles from './styles/app.module.css';
import { Toasts } from './ui';
import { Activity } from './views/Activity';
import { FirstRun, SoloFrame } from './views/FirstRun';
import { ImposterDetail } from './views/ImposterDetail';
import { Imposters } from './views/Imposters';
import { Overview } from './views/Overview';
import { Settings } from './views/Settings';

/* ────────────────────────────────  landing  ────────────────────────────── */

/**
 * Where an environment-less URL should land: the one the visitor was last
 * working in while it still exists, else the first defined one, else nowhere
 * because nothing is defined yet.
 */
function useLanding(): MbEnvironment | undefined {
  const list = useEnvironments((s) => s.list);
  const remembered = useStudio((s) => s.env);
  return list.find((e) => e.id === remembered) ?? list[0];
}

/* ────────────────────────────────  shell  ──────────────────────────────── */

/**
 * The frame: forest rail, topbar, one scrolling content column, and the two
 * always-mounted overlays (the palette listens for ⌘K even while closed, and
 * the toast region is a live region that must not come and go).
 */
function Shell() {
  const params = useParams();
  const location = useLocation();
  const list = useEnvironments((s) => s.list);
  const setEnv = useStudio((s) => s.setEnv);
  const contentRef = useRef<HTMLElement>(null);

  // `named` is what the URL asked for; `known` is whether it is one of ours.
  const named = params.env;
  const known = list.some((e) => e.id === named);

  // the URL leads, the store follows
  useEffect(() => {
    if (known && named !== undefined) setEnv(named);
  }, [known, named, setEnv]);

  // a new screen starts at its own top, exactly as the prototype's render() did
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  const fallback = list[0];

  // Deleting the last environment while the app is open leaves nothing to fall
  // back to, and inventing one would be a lie — the welcome is the honest answer.
  if (fallback === undefined) return <FirstRun />;

  if (named === undefined || !known) {
    // keep the view the visitor asked for, just under an environment that exists
    const rest = location.pathname.split('/').slice(2).join('/');
    return <Navigate to={`/${fallback.id}/${rest || 'overview'}${location.search}`} replace />;
  }

  const env: EnvId = named;

  return (
    <div className={`app ${styles.app}`}>
      <Sidebar env={env} />

      <div className={styles.main}>
        <Topbar env={env} />
        {/* tabIndex -1 so the skip target and post-navigation focus have a home */}
        <main ref={contentRef} className={`content ${styles.content}`} tabIndex={-1}>
          <div className={styles.wrap}>
            {DEMO_BUILD ? <DemoBanner /> : null}
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette env={env} />
      <Toasts />
    </div>
  );
}

/* ────────────────────────────────  routes  ─────────────────────────────── */

/** `/` lands on the environment the visitor was last working in. */
function RootRedirect() {
  const landing = useLanding();
  if (landing === undefined) return <FirstRun />;
  return <Navigate to={`/${landing.id}/overview`} replace />;
}

/**
 * `/settings` names no environment, and it has to work in both states: it is the
 * only way out of the empty one — the welcome's own button points here — and it
 * is where someone lands who bookmarked Settings before the list changed. With
 * an environment to name, the screen belongs inside the shell under it.
 */
function SettingsEntry() {
  const landing = useLanding();
  if (landing === undefined) {
    return (
      <SoloFrame>
        <Settings />
      </SoloFrame>
    );
  }
  return <Navigate to={`/${landing.id}/settings`} replace />;
}

export default function App() {
  const empty = useEnvironments((s) => s.list).length === 0;
  const welcome = useStudio((s) => s.welcome);

  /*
   * Either nothing is defined yet, or the welcome is being held open while the
   * first environments are added on it. Every route answers with the welcome and
   * NOTHING redirects: a deep link someone was sent keeps its URL, so it works
   * the moment the environment behind it exists. Start closes this branch.
   */
  if (empty || welcome) {
    return (
      <>
        <Routes>
          {/* While the welcome is held open the shell already exists, so this
              would redirect into it and leave the screen behind mid-flow. The
              welcome adds environments itself, so it is not needed then. */}
          {empty ? <Route path="/settings" element={<SettingsEntry />} /> : null}
          <Route path="*" element={<FirstRun />} />
        </Routes>
        <Toasts />
      </>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      {/* a static segment outranks `/:env`, so this wins over an environment
          that happens to be called "settings" */}
      <Route path="/settings" element={<SettingsEntry />} />

      <Route path="/:env" element={<Shell />}>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<Overview />} />
        <Route path="imposters" element={<Imposters />} />
        <Route path="imposters/:port" element={<ImposterDetail />} />
        <Route path="activity" element={<Activity />} />
        {/* the screen used to be called Requests — old links keep working */}
        <Route path="requests" element={<Navigate to="../activity" replace />} />
        <Route path="settings" element={<Settings />} />
        {/* an unknown view under a known environment is still a known place */}
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Route>
    </Routes>
  );
}
