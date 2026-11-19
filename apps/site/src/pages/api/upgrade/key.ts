import type { APIRoute } from 'astro';
import { KeyReminderRequestSchema } from '@boombapbot/contracts';
import { resolveUser } from '../../../server/session';
import { afterResponse, json } from '../../../server/site';
import { licenseOf, mayRemindKeys, refuse, remindKeys } from '../../../server/upgrade';

export const prerender = false;

/** The license key of the account that is asking. */
export const GET: APIRoute = async ({ request }) => {
  const account = await resolveUser(request);
  if (!account) return refuse('signed_out');
  const license = await licenseOf(account);
  return license ? json({ license }) : refuse('no_license');
};

/**
 * Asks for the keys bought with an address to be emailed to it again, for
 * a buyer with no account to look in. The answer is the same whether or not
 * the address ever bought anything, so it tells nobody who has: the keys are
 * looked up and sent after it has gone, so it does not come sooner for an
 * address with none either.
 */
export const POST: APIRoute = async ({ request }) => {
  const asked = KeyReminderRequestSchema.safeParse(await request.json().catch(() => null));
  if (!asked.success) return refuse('invalid');
  const { email } = asked.data;
  if (!(await mayRemindKeys(request, email))) return refuse('too_many');
  afterResponse(remindKeys(email), 'Emailing a license key again');
  return json({ received: true }, 202);
};
