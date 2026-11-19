import type { ReactNode } from 'react';

/**
 * What sits under the machine in a shell with no site behind it: its
 * settings and nothing else. Hand it to `BoombapbotEditor` as `below`.
 */
export function shellFooter(settings: ReactNode): ReactNode {
  return (
    <footer className="sb-footer">
      <div className="sb-footer-icons sb-footer-tools">{settings}</div>
    </footer>
  );
}
