import type { APIRoute } from 'astro';
import { LicenseFileRequestSchema } from '@boombapbot/contracts';
import { requestAddress } from '../../../server/auth';
import { licenseFileForAccount, licenseFileForKey, type LicenseFileOutcome } from '../../../server/license-file';
import { consumeRateLimit } from '../../../server/rate-limit';
import { resolveUser } from '../../../server/session';
import { json } from '../../../server/site';
import { refuse } from '../../../server/upgrade';

export const prerender = false;

const answer = (outcome: LicenseFileOutcome): Response =>
  'file' in outcome ? json({ file: outcome.file }) : refuse(outcome.refusal);

/** A signed license file for the account that is asking. */
export const GET: APIRoute = async ({ request }) => {
  const account = await resolveUser(request);
  return account ? answer(await licenseFileForAccount(account)) : refuse('signed_out');
};

/**
 * A signed license file for a key, with nobody logged in: what the desktop
 * app and the plugin ask with. One place can try ten keys in ten minutes, so
 * keys cannot be guessed at speed.
 */
export const POST: APIRoute = async ({ request }) => {
  const asked = LicenseFileRequestSchema.safeParse(await request.json().catch(() => null));
  if (!asked.success) return refuse('invalid');
  if (!(await consumeRateLimit(await requestAddress(request), '/site/license-by-key/ip'))) return refuse('too_many');
  return answer(await licenseFileForKey(asked.data.key));
};
