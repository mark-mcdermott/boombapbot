import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { OUTBOX } from './accounts-server';

// The test server files its email in a folder instead of sending it.

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export const newAddress = () => `drummer-${randomUUID()}@example.com`;

/** Mail filed for one address, oldest first. */
export function mailTo(address: string, subject: RegExp): Mail[] {
  if (!existsSync(OUTBOX)) return [];
  return readdirSync(OUTBOX)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(OUTBOX, file), 'utf8')) as Mail)
    .filter((mail) => mail.to === address && subject.test(mail.subject));
}

/** The link in the newest matching email, once it has arrived. */
export async function linkIn(address: string, subject: RegExp): Promise<string> {
  const link = () => mailTo(address, subject).at(-1)?.text.match(/https?:\/\/\S+/)?.[0] ?? '';
  await expect.poll(link).not.toBe('');
  return link();
}
