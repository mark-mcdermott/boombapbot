import { spawn } from 'node:child_process';
import { expect, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test';
import { serverEnv } from './accounts-server';

// Most tests share the one built server the configuration starts, which runs
// with its limits off and the upgrade open. A test that needs the server
// some other way starts one more for itself.

export interface SecondServer {
  /** Asks this server, with nobody logged in. */
  request: APIRequestContext;
  /** Stops it, and comes back once it has gone. */
  stop(): Promise<void>;
}

/**
 * Starts the built server on a port of its own and waits until it answers.
 * It gets the settings every test server has, then `env`, and nothing else,
 * so no switch set in a shell reaches it: its limits are on and the upgrade
 * is closed unless `env` says otherwise.
 */
export async function startServer(
  playwright: PlaywrightWorkerArgs['playwright'],
  port: number,
  env: Record<string, string> = {},
): Promise<SecondServer> {
  const server = spawn(process.execPath, ['apps/site/dist/server/entry.mjs'], {
    env: { ...serverEnv(port), ...env },
    stdio: 'ignore',
  });
  const gone = new Promise<void>((resolve) => server.once('exit', () => resolve()));
  const request = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${port}` });
  await expect
    .poll(async () => (await request.get('/api/upgrade').catch(() => null))?.status() ?? 0, { timeout: 20_000 })
    .toBe(200);
  return {
    request,
    async stop() {
      await request.dispose();
      server.kill();
      await gone;
    },
  };
}
