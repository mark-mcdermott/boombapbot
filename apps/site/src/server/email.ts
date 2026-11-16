import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EMAIL_FROM, EMAIL_OUTBOX, RESEND_API_KEY } from 'astro:env/server';
import { Resend } from 'resend';

/** How long a link in an email works. The emails say so, and the auth config uses it. */
export const LINK_LIFETIME_SECONDS = 60 * 60;

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * With EMAIL_OUTBOX set, mail is written to that folder and nothing is sent.
 * That is how the browser tests read their links, and how sign-up can be
 * tried on a laptop before a sending domain exists.
 */
async function fileInOutbox(folder: string, message: EmailMessage): Promise<void> {
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(message, null, 2));
}

/**
 * Throws when the message did not go, so a caller cannot take silence for
 * success. Better Auth sends the verification email in the background, so a
 * failure there is logged and sign-up still answers 200: the account modal
 * always offers to send it again for that reason.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  if (EMAIL_OUTBOX) {
    await fileInOutbox(EMAIL_OUTBOX, message);
    return;
  }
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    throw new Error('RESEND_API_KEY and EMAIL_FROM must both be set to send email. Nothing was sent.');
  }
  const { error } = await new Resend(RESEND_API_KEY).emails.send({ from: EMAIL_FROM, ...message });
  if (error) throw new Error(`Resend refused the message: ${error.message}`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

interface LinkEmail {
  to: string;
  subject: string;
  /** What the link is for. */
  lead: string;
  action: string;
  url: string;
  /** What happens if the reader did not ask for this. */
  otherwise: string;
}

const SIGN_OFF = 'boombapbot is one person and a lot of coffee.';

function linkEmail({ to, subject, lead, action, url, otherwise }: LinkEmail): EmailMessage {
  const href = escapeHtml(url);
  return {
    to,
    subject,
    text: `${lead}\n\n${url}\n\nThe link works for an hour. ${otherwise}\n\n${SIGN_OFF}\n`,
    html: `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.6;color:#171513;max-width:480px">
  <p>${escapeHtml(lead)}</p>
  <p><a href="${href}" style="display:inline-block;background:#171513;color:#f4efe8;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${escapeHtml(action)}</a></p>
  <p style="font-size:14px;color:#5c554d">The link works for an hour. ${escapeHtml(otherwise)}</p>
  <p style="font-size:14px;color:#5c554d">${SIGN_OFF}</p>
</div>`,
  };
}

export async function sendVerificationEmail(to: string, url: string): Promise<void> {
  await sendEmail(
    linkEmail({
      to,
      subject: 'Confirm your email for boombapbot',
      lead: 'Someone, hopefully you, made a boombapbot account with this address. Confirm it is yours and you are in.',
      action: 'Confirm my email',
      url,
      otherwise: 'If that was not you, ignore this and nothing happens.',
    }),
  );
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  await sendEmail(
    linkEmail({
      to,
      subject: 'Reset your boombapbot password',
      lead: 'Here is the link to choose a new password for your boombapbot account.',
      action: 'Choose a new password',
      url,
      otherwise: 'If you did not ask for it, ignore this and your password stays as it is.',
    }),
  );
}
