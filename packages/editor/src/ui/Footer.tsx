import { Heart } from 'lucide-react';
import type { RefObject } from 'react';
import { Settings } from './Settings';

/** The row under the machine: who made it, and the way into settings. */
export function Footer({ sheetContainer }: { sheetContainer: RefObject<HTMLElement | null> }) {
  return (
    <footer className="sb-footer">
      <p className="sb-made" data-testid="made-by">
        built with <Heart className="sb-heart" role="img" aria-label="love" /> by{' '}
        <a href="https://mm.coffee" target="_blank" rel="noreferrer noopener">
          mm.coffee
        </a>
      </p>
      <Settings container={sheetContainer} />
    </footer>
  );
}
