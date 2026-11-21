import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
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
  // Written under another name and then renamed, so whoever reads the folder never finds half a message.
  const file = join(folder, `${Date.now()}-${randomUUID()}.json`);
  await writeFile(`${file}.part`, JSON.stringify(message, null, 2));
  await rename(`${file}.part`, file);
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
  /** False for a link to the site itself, which carries nothing that runs out. */
  expires?: boolean;
}

const SIGN_OFF = 'boombapbot is one person and a lot of coffee.';
const BODY_STYLE =
  "font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.6;color:#171513;max-width:480px";
const NOTE_STYLE = 'font-size:14px;color:#5c554d';
const KEY_STYLE =
  'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:18px;letter-spacing:0.04em;background:#f4efe8;padding:12px 16px;border-radius:8px';

function linkEmail({ to, subject, lead, action, url, otherwise, expires = true }: LinkEmail): EmailMessage {
  const href = escapeHtml(url);
  const note = expires ? `The link works for an hour. ${otherwise}` : otherwise;
  return {
    to,
    subject,
    text: `${lead}\n\n${url}\n\n${note}\n\n${SIGN_OFF}\n`,
    html: `<div style="${BODY_STYLE}">
  <p>${escapeHtml(lead)}</p>
  <p><a href="${href}" style="display:inline-block;background:#171513;color:#f4efe8;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${escapeHtml(action)}</a></p>
  <p style="${NOTE_STYLE}">${escapeHtml(note)}</p>
  <p style="${NOTE_STYLE}">${SIGN_OFF}</p>
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

/**
 * To an address that already has an account, when somebody signs up with it
 * again. The page they signed up on says only to check the inbox, as it does
 * for a new address, so this is where its owner learns what happened.
 */
export async function sendExistingAccountEmail(to: string, url: string): Promise<void> {
  await sendEmail(
    linkEmail({
      to,
      subject: 'You already have a boombapbot account',
      lead: 'Someone, hopefully you, tried to make a boombapbot account with this address. It already has one, so no new account was made. Log in with the password you chose before, or choose a new one here.',
      action: 'Choose a new password',
      url,
      otherwise: 'If that was not you, ignore this. Nobody got in and nothing changed.',
      expires: false,
    }),
  );
}

interface KeyEmail {
  to: string;
  /** Why the key is being sent. */
  lead: string;
  key: string;
  /** What to do with the email. */
  note: string;
}

function keyEmail({ to, lead, key, note }: KeyEmail): EmailMessage {
  return {
    to,
    subject: 'Your boombapbot license key',
    text: `${lead}\n\n${key}\n\n${note}\n\n${SIGN_OFF}\n`,
    html: `<div style="${BODY_STYLE}">
  <p>${escapeHtml(lead)}</p>
  <p style="${KEY_STYLE}">${escapeHtml(key)}</p>
  <p style="${NOTE_STYLE}">${escapeHtml(note)}</p>
  <p style="${NOTE_STYLE}">${SIGN_OFF}</p>
</div>`,
  };
}

/** The key, to the address that paid for it. */
export async function sendLicenseKeyEmail(to: string, key: string): Promise<void> {
  await sendEmail(
    keyEmail({
      to,
      lead: 'Thank you for buying the boombapbot upgrade. This is your license key.',
      key,
      note: 'Keep this email so you can find the key again.',
    }),
  );
}

/** The key again, to the address it was bought with, because somebody asked. */
export async function sendLicenseKeyReminder(to: string, key: string): Promise<void> {
  await sendEmail(
    keyEmail({
      to,
      lead: 'Someone, hopefully you, asked for the boombapbot license key bought with this address. Here it is.',
      key,
      note: 'If that was not you, ignore this. The key went nowhere but here.',
    }),
  );
}
