/**
 * The topbar: where you are, how to find things, how much detail you want, and
 * the one action this screen is for.
 *
 * Which environment you are in reads in the sidebar's Connections card, and the
 * list itself is kept in Settings — this bar says where you are inside it.
 *
 * The primary action navigates rather than reaching into a screen: `?new=stub`
 * on an imposter route, `?new=imposter` on the list. See App.tsx for the
 * contract.
 */

import { Link, useLocation, useMatch } from 'react-router-dom';

import type { EnvId } from '../lib/environments';
import { useImposter } from '../lib/queries';
import { useStudio } from '../store/useStudio';
import { Icon } from '../ui';
import appStyles from '../styles/app.module.css';
import styles from './Topbar.module.css';

export interface TopbarProps {
  env: EnvId;
}

const TITLES: Record<string, string> = {
  overview: 'Overview',
  imposters: 'Imposters',
  activity: 'Activity',
  settings: 'Settings',
};

export function Topbar({ env }: TopbarProps) {
  const location = useLocation();

  const setPaletteOpen = useStudio((s) => s.setPaletteOpen);

  const onImposter = useMatch('/:env/imposters/:port');
  const port = onImposter?.params.port ? Number(onImposter.params.port) : null;

  // the same query key the imposter screen uses, so this crumb costs no request
  const detail = useImposter(env, port ?? 0);
  const imposterName = detail.data?.imposter.name;

  const segment = location.pathname.split('/')[2] ?? 'overview';
  const title = TITLES[segment] ?? 'Overview';

  return (
    <header className={['topbar', appStyles.topbar, styles.bar].filter(Boolean).join(' ')}>
      <div className={styles.row}>
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          {port !== null ? (
            <>
              <Link className={styles.crumb} to={`/${env}/imposters`}>
                Imposters
              </Link>
              <span className={styles.sep} aria-hidden="true">
                /
              </span>
              <strong className={styles.here}>
                {imposterName ?? (detail.isError ? `port ${port} — unavailable` : `port ${port}`)}
              </strong>
            </>
          ) : (
            <strong className={styles.here}>{title}</strong>
          )}
        </nav>

        <div className={styles.spacer} />

        <button
          type="button"
          className={`searchbtn ${styles.search}`}
          onClick={() => setPaletteOpen(true)}
          title="Search imposters and stubs (⌘K)"
          aria-label="Search imposters and stubs"
        >
          <Icon name="search" />
          <span>Search imposters and stubs</span>
          <kbd className={styles.kbd}>⌘K</kbd>
        </button>
      </div>
    </header>
  );
}
