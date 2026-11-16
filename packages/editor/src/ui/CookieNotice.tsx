import { useState } from 'react';
import { browserStorage } from '../state/draft-storage';

const SEEN_KEY = 'boombapbot.storage-notice.v1';

/**
 * What the site keeps in the browser, said once. It sits in the page above
 * the footer, so it never covers the machine.
 */
export function CookieNotice({ baseUrl }: { baseUrl: string }) {
  const [storage] = useState(browserStorage);
  const [seen, setSeen] = useState(() => storage?.getItem(SEEN_KEY) === '1');
  if (seen) return null;

  const dismiss = () => {
    setSeen(true);
    storage?.setItem(SEEN_KEY, '1');
  };
  return (
    <aside className="sb-cookie-notice" data-testid="cookie-notice" aria-label="Cookies and storage">
      <p>
        I don&rsquo;t track you and there are no ads. Your beats are saved in this browser, and if you log in, one
        cookie keeps you logged in.{' '}
        <a className="sb-link" href={`${baseUrl}policies`}>
          Policies
        </a>
      </p>
      <button className="sb-button" type="button" data-testid="cookie-notice-ok" onClick={dismiss}>
        OK
      </button>
    </aside>
  );
}
