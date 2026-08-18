/**
 * The forest rail.
 *
 * Order is load-bearing and matches the approved prototype: brand, environment
 * switcher, the four two-line sections, the imposter quick-list, the
 * Connections card, and Settings LAST at the very bottom of the rail.
 *
 * The Connections card never claims an instance is reachable on the strength of
 * a pending query. Loading is amber, failure is terracotta, and only a query
 * that actually resolved paints a healthy dot — otherwise the rail would report
 * "connected" to a mountebank that is down.
 */

import { Link, useLocation } from 'react-router-dom';

import type { EnvId } from '../lib/environments';
import { useCause } from '../lib/mb/reach';
import { useConfig, useImposters } from '../lib/queries';
import { useEnvironments } from '../store/useEnvironments';
import { Icon, type IconName } from '../ui';
import styles from './Sidebar.module.css';

export interface SidebarProps {
  env: EnvId;
}

interface Section {
  slug: string;
  label: string;
  desc: string;
  icon: IconName;
}

const SECTIONS: Section[] = [
  { slug: 'overview', label: 'Overview', desc: 'State and coverage', icon: 'dash' },
  { slug: 'imposters', label: 'Imposters', desc: 'Mock servers and ports', icon: 'imps' },
  { slug: 'activity', label: 'Activity', desc: 'Everything captured', icon: 'act' },
  { slug: 'settings', label: 'Settings', desc: 'Connection and defaults', icon: 'cog' },
];

/** Health of one Connections row. Amber is "we do not know yet". */
type Dot = 'ok' | 'warn' | 'err';

/** The host of the admin API this environment names — the panel's own target. */
function hostOf(target: string): string {
  try {
    return new URL(target).host;
  } catch {
    return target;
  }
}

/**
 * Said instead of a name the user would not recognise. An environment can be
 * deleted while its screen is still on, and naming one that no longer exists
 * would be worse than admitting there is nothing to name.
 */
const GONE = 'not defined';

export function Sidebar({ env }: SidebarProps) {
  /* Selected from the store rather than looked up once: the list is the user's
     own, so a rename in Settings has to reach this card, and an id that was
     valid a moment ago may now resolve to nothing. */
  const environment = useEnvironments((s) => s.list.find((e) => e.id === env));
  const location = useLocation();

  const imposters = useImposters(env);
  const config = useConfig(env);

  const list = imposters.data ?? [];
  const requestCount = list.reduce((n, i) => n + i.numberOfRequests, 0);

  /* ---- counts: a number only once the query has actually answered ---- */
  const count = (n: number): string =>
    imposters.isPending ? '·' : imposters.isError ? '—' : String(n);

  const countFor = (slug: string): string | undefined => {
    if (slug === 'imposters') return count(list.length);
    if (slug === 'activity') return count(requestCount);
    // Overview is a derived view — there is no count to be honest about
    return undefined;
  };

  /* ---- Connections: where the panel points, and whether it answered ---- */
  const configDot: Dot = config.isPending ? 'warn' : config.isError ? 'err' : 'ok';

  /* An environment that is no longer defined is a fault: nothing can be read or
     written until the URL names one that exists. */
  const envDot: Dot = environment === undefined ? 'err' : 'ok';

  const versionText = config.isPending
    ? 'checking…'
    : config.isError
      ? 'unreachable'
      : `mountebank ${config.data?.version ?? '?'}`;

  const failed = config.isError || imposters.isError;
  /* The footer is the one thing on screen in every state, so it is worth saying
     which of the two failures this is rather than just that there was one. */
  const cause = useCause(environment?.target ?? '', config.error ?? imposters.error);

  /* ---- one nav row, two lines, optional count ---- */
  const navRow = (section: Section, value?: string) => {
    const to = `/${env}/${section.slug}`;
    const current = location.pathname === to;
    return (
      <Link
        key={section.slug}
        to={to}
        className={`nav ${styles.nav}`}
        aria-current={current ? 'page' : undefined}
        title={section.label}
        aria-label={`${section.label} — ${section.desc}`}
      >
        <Icon name={section.icon} />
        <span className={styles.navTxt}>
          <b>{section.label}</b>
          <span>{section.desc}</span>
        </span>
        {value !== undefined ? <span className={`num ${styles.navCount}`}>{value}</span> : null}
      </Link>
    );
  };

  return (
    <aside className={`side ${styles.side}`} aria-label="Studio navigation">
      {/* The wordmark is the way back to the top of this environment, as it is in
          every other product with a rail. */}
      <Link to={`/${env}/overview`} className={styles.brand} title="Overview">
        <div className={styles.mark} aria-hidden="true">
          <span>
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className={styles.brandTxt}>
          Mountebank <em>Studio</em>
        </div>
      </Link>

      <nav className={styles.group} aria-label="Sections">
        {SECTIONS.map((s) => navRow(s, countFor(s.slug)))}
      </nav>

      <div className={styles.srcs}>
        <span className="lbl">Connections</span>

        {/* Which mountebank you are editing. It reads here rather than in the
            header because this card is already the "where am I pointed" block. */}
        <div className={styles.src}>
          <span className={`${styles.srcDot} ${styles[envDot]}`} />
          <div className={styles.srcTxt}>
            <b>Environment</b>
            <span>{environment?.label ?? GONE}</span>
          </div>
        </div>

        <div className={styles.src}>
          <span className={`${styles.srcDot} ${styles[configDot]}`} />
          <div className={styles.srcTxt}>
            <b>Admin API</b>
            <span>{environment === undefined ? GONE : hostOf(environment.target)}</span>
          </div>
        </div>

        <div className={styles.src}>
          <span className={`${styles.srcDot} ${styles[configDot]}`} />
          <div className={styles.srcTxt}>
            <b>Version</b>
            <span>{versionText}</span>
          </div>
        </div>

        {/* This card states where the panel points and whether that answered. It
            carries no action: retrying belongs to the screen that failed, which
            already offers it, and a second button here only asked the same
            question in a place with no room to report the answer. */}
        <div className={styles.srcsFoot}>
          {failed ? (
            <span className={styles.footNote}>
              {cause?.blocked === true
                ? `${environment?.label ?? 'This environment'} will not answer this page`
                : `No answer from ${environment?.label ?? 'this environment'}`}
            </span>
          ) : (
            <span className={styles.sign}>Keep It Simple</span>
          )}
        </div>
      </div>
    </aside>
  );
}
