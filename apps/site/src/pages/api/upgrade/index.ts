import type { APIRoute } from 'astro';
import { UPGRADE_CURRENCY, UPGRADE_PRICE_CENTS, type UpgradeAnswer } from '@boombapbot/contracts';
import { isUpgraded, resolveUser } from '../../../server/session';
import { json } from '../../../server/site';
import { upgradeOpen } from '../../../server/upgrade';

export const prerender = false;

/** Whether the upgrade is for sale, what it costs, and whether whoever asks has it. */
export const GET: APIRoute = async ({ request }) => {
  const account = await resolveUser(request);
  const answer: UpgradeAnswer = {
    open: upgradeOpen(),
    priceCents: UPGRADE_PRICE_CENTS,
    currency: UPGRADE_CURRENCY,
    upgraded: account !== null && (await isUpgraded(account)),
  };
  return json(answer);
};
