import { expect, test } from '@playwright/test';
import { openEditor } from './helpers';

// A host with no account server can still answer 200 where the server would
// be: with its own page, or with something empty. Nobody is logged in then,
// and the page must not fall over finding that out.

const ANSWERS = [
  { name: 'its own page', contentType: 'text/html', body: '<!doctype html><title>Not the account server</title>' },
  { name: 'an empty object', contentType: 'application/json', body: '{}' },
];

for (const { name, contentType, body } of ANSWERS) {
  test(`a host that answers the session question with ${name} leaves the visitor logged out`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/auth/get-session', (route) => route.fulfill({ status: 200, contentType, body }));
    await openEditor(page);
    const account = page.getByTestId('account');
    await expect(account).toHaveAccessibleName('Account');
    await account.click();
    await expect(page.getByTestId('account-log-in')).toBeVisible();
    await expect(page.getByTestId('editor')).toBeVisible();
    expect(errors).toEqual([]);
  });
}
