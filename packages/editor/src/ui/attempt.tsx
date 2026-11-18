import { useState, type ReactNode } from 'react';
import { explain, type Failure } from '../account/client';

// What the modals that talk to the server share: one call at a time, the
// line that says what went wrong, and a button that reads as a link.

/** One call to the server at a time, with what went wrong kept for showing. */
export function useAttempt() {
  const [waiting, setWaiting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (call: () => Promise<Failure | null>) => {
    setWaiting(true);
    setProblem(null);
    const failure = await call();
    setWaiting(false);
    setProblem(failure ? explain(failure) : null);
  };
  return { waiting, problem, run };
}

/** What went wrong, said aloud when it appears. It takes no room while there is nothing to say. */
export function Problem({ text, testId }: { text: string | null; testId: string }) {
  return (
    <p className="sb-form-problem" role="alert" data-testid={testId}>
      {text}
    </p>
  );
}

export function LinkButton({ testId, onClick, children }: { testId: string; onClick(): void; children: ReactNode }) {
  return (
    <button className="sb-link" type="button" data-testid={testId} onClick={onClick}>
      {children}
    </button>
  );
}
