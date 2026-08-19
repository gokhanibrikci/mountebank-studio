/**
 * The line that keeps the demo from lying.
 *
 * Everything on the screens below is real panel code reading a real admin API — the API
 * just happens to be a stand-in inside this tab. That makes the demo faithful and also
 * makes it easy to mistake for a running system, so this says what it is on every screen
 * rather than once on the way in: nothing is listening, the ports answer nobody, and what
 * you change here goes away when you reload.
 */

import { resetDemo } from '../lib/demo/instance';
import { useStudio } from '../store/useStudio';
import { Button, Icon } from '../ui';
import styles from './DemoBanner.module.css';

const REPO = 'https://github.com/gokhanibrikci/mountebank-studio';

export function DemoBanner() {
  const toast = useStudio((s) => s.toast);

  function reset(): void {
    resetDemo();
    toast('The demo is back to how it started');
    /* A reload is the honest way to clear every cached read at once. */
    window.setTimeout(() => window.location.reload(), 250);
  }

  return (
    <div className={styles.bar} role="note">
      <Icon name="bolt" />
      <p className={styles.text}>
        <b>This is a demo.</b> Nothing is running: the panel is talking to a stand-in for a
        Mountebank admin API inside this browser tab. Create an imposter, edit a stub, read the
        captured traffic — it all works, it just answers nobody, and a reload puts it back. For the
        real thing:{' '}
        <code className={styles.cmd}>npx mountebank-studio</code>{' '}
        <a className={styles.link} href={REPO} target="_blank" rel="noreferrer">
          on GitHub
        </a>
        .
      </p>
      <Button size="sm" variant="ghost" onClick={reset} title="Back to the imposters it started with">
        Reset
      </Button>
    </div>
  );
}

export default DemoBanner;
