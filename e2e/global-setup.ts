import { rmSync } from 'node:fs';
import { OUTBOX } from './accounts-server';

/** Starts every run with an empty outbox, so no test reads an earlier run's mail. */
export default function globalSetup(): void {
  rmSync(OUTBOX, { recursive: true, force: true });
}
