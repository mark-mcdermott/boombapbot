/**
 * The page's side of JUCE's web view: functions the plugin offers, called by
 * name, and events it sends. This is the wire JUCE's own `index.js` speaks,
 * written out here in the few lines the panel needs.
 */

interface JuceBackend {
  emitEvent(event: string, payload: unknown): void;
  addEventListener(event: string, listener: (payload: never) => void): unknown;
  removeEventListener(token: unknown): void;
}

declare global {
  interface Window {
    __JUCE__?: { backend: JuceBackend };
  }
}

export interface Plugin {
  call<Answer>(name: string, ...params: unknown[]): Promise<Answer>;
  on<Payload>(event: string, listener: (payload: Payload) => void): () => void;
}

/** The plugin behind this page, or null when the page is open somewhere else. */
export function connectPlugin(): Plugin | null {
  const backend = window.__JUCE__?.backend;
  if (!backend) return null;

  let lastCall = 0;
  const waiting = new Map<number, (answer: unknown) => void>();
  backend.addEventListener('__juce__complete', ({ promiseId, result }: { promiseId: number; result: unknown }) => {
    waiting.get(promiseId)?.(result);
    waiting.delete(promiseId);
  });

  return {
    call<Answer>(name: string, ...params: unknown[]): Promise<Answer> {
      const resultId = lastCall++;
      const answer = new Promise<Answer>((resolve) => waiting.set(resultId, resolve as (answer: unknown) => void));
      backend.emitEvent('__juce__invoke', { name, params, resultId });
      return answer;
    },
    on<Payload>(event: string, listener: (payload: Payload) => void): () => void {
      const token = backend.addEventListener(event, listener as (payload: never) => void);
      return () => backend.removeEventListener(token);
    },
  };
}
