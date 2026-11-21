import type { APIRoute } from 'astro';
import { readAvatar, refuseAvatar, removeAvatar, saveAvatar } from '../../../server/avatars';
import { resolveUser } from '../../../server/session';
import { json } from '../../../server/site';

export const prerender = false;

/** Makes the picture sent the account's picture, in place of any it had. */
export const PUT: APIRoute = async ({ request }) => {
  const account = await resolveUser(request);
  const sent = await readAvatar(request);
  if (!account) return refuseAvatar('signed_out');
  if (typeof sent === 'string') return refuseAvatar(sent);
  return json({ image: await saveAvatar(account, sent.bytes, sent.type) });
};

/** Takes the account's picture away, so it shows the one every account starts with. */
export const DELETE: APIRoute = async ({ request }) => {
  const account = await resolveUser(request);
  if (!account) return refuseAvatar('signed_out');
  await removeAvatar(account);
  return json({ image: null });
};
