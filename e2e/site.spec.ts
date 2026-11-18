import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openEditor } from './helpers';

test.describe('the page around the machine', () => {
  test('the header is the brand alone, with no machines to choose from for now', async ({ page }) => {
    await openEditor(page);
    await expect(page.getByTestId('brand')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Machines' })).toHaveCount(0);
    await expect(page.locator('[data-testid^="machine-"]')).toHaveCount(0);
  });

  test('the footer has about, docs, manifesto, credits, policies, upgrade, cart, settings and account, in that order', async ({ page }) => {
    await openEditor(page);
    const ids = ['nav-about', 'nav-docs', 'nav-manifesto', 'nav-credits', 'nav-policies', 'upgrade', 'cart', 'settings', 'account'];
    const xs: number[] = [];
    for (const id of ids) xs.push((await page.getByTestId(id).boundingBox())!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    await expect(page.getByTestId('nav-about')).toHaveAccessibleName('About');
    await expect(page.getByTestId('nav-docs')).toHaveAccessibleName('Docs');
    await expect(page.getByTestId('nav-manifesto')).toHaveAccessibleName('Manifesto');
    await expect(page.getByTestId('nav-credits')).toHaveAccessibleName('Credits');
    await expect(page.getByTestId('nav-policies')).toHaveAccessibleName('Policies');
    await expect(page.getByTestId('upgrade')).toHaveAccessibleName('Upgrade');
    await expect(page.getByTestId('cart')).toHaveAccessibleName('Cart');
    await expect(page.getByTestId('account')).toHaveAccessibleName('Account');
  });

  test('settings, upgrade, cart and account each open as a modal in the middle of the page', async ({ page }) => {
    await openEditor(page);
    const view = page.viewportSize()!;
    for (const id of ['settings', 'upgrade', 'cart', 'account']) {
      await page.getByTestId(id).click();
      const modal = page.getByTestId(`${id}-modal`);
      await expect(modal).toBeVisible();
      await expect(modal.getByRole('heading')).toBeVisible();
      await expect
        .poll(async () => {
          const box = (await modal.boundingBox())!;
          return Math.abs(box.x + box.width / 2 - view.width / 2);
        })
        .toBeLessThan(2);
      // It fades in; a scan of half-faded text would see contrast that is not there.
      await expect.poll(() => modal.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(modal).toHaveCount(0);
      await expect(page.getByTestId(id)).toBeFocused();
    }
    // Upgrades and the shop are not switched on, and they say so without offering a form.
    await page.getByTestId('upgrade').click();
    await expect(page.getByTestId('upgrade-modal')).toContainText('not open yet');
    await expect(page.getByTestId('upgrade-modal').locator('input, button:not([data-testid="upgrade-close"])')).toHaveCount(0);
    await page.getByTestId('upgrade-close').click();
    await page.getByTestId('account').click();
    // These pages are served as plain files with no server behind them. The
    // account modal says it cannot reach one, and the machine carries on.
    await expect(page.getByTestId('account-unreachable')).toContainText('The machine does not need it');
    await expect(page.getByTestId('account-modal').locator('input')).toHaveCount(0);
    await expect(page.getByTestId('account-retry')).toBeVisible();
    // Saved beats need the server, so nothing about them is offered here.
    await expect(page.getByTestId('beats')).toHaveCount(0);
    await page.getByTestId('account-close').click();
    await page.getByTestId('cart').click();
    await expect(page.getByTestId('shop-unreachable')).toContainText('The machine does not need it');
  });

  test('the tagline sits under the mascot, and together they are as tall as the wordmark beside them', async ({ page }) => {
    await openEditor(page);
    const tagline = page.getByTestId('tagline');
    await expect(tagline).toHaveText('Let’s cook');
    const words = (await tagline.boundingBox())!;
    const mascot = (await page.getByTestId('brand-mascot').boundingBox())!;
    const mark = (await page.locator('.sb-wordmark').boundingBox())!;
    expect(words.y).toBeGreaterThanOrEqual(mascot.y + mascot.height);
    // Centred under the mascot.
    expect(Math.abs(words.x + words.width / 2 - (mascot.x + mascot.width / 2))).toBeLessThanOrEqual(2);
    expect(mark.x).toBeGreaterThan(Math.max(mascot.x + mascot.width, words.x + words.width));
    // The mascot starts level with the top of the wordmark and the tagline's letters stand on its foot.
    expect(Math.abs(mascot.y - mark.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(words.y + words.height - (mark.y + mark.height))).toBeLessThanOrEqual(1);
  });

  test('the footer sits 50px under the machine once the notice is closed', async ({ page }) => {
    await openEditor(page);
    const drop = async () => {
      const machine = (await page.getByTestId('machine').boundingBox())!;
      const footer = (await page.locator('.sb-footer').boundingBox())!;
      return footer.y - (machine.y + machine.height);
    };
    // The notice is taller than that, so it holds the footer lower while it shows.
    await expect(page.getByTestId('cookie-notice')).toBeVisible();
    expect(await drop()).toBeGreaterThan(50);
    await page.getByTestId('cookie-notice-ok').click();
    await expect(page.getByTestId('cookie-notice')).toHaveCount(0);
    expect(await drop()).toBeCloseTo(50, 0);
  });

  test('the footer’s icons are one set on the right, with the credit on the left', async ({ page }) => {
    await openEditor(page);
    const footer = (await page.locator('.sb-footer').boundingBox())!;
    const made = (await page.locator('.sb-made').boundingBox())!;
    const lastPage = (await page.getByTestId('nav-policies').boundingBox())!;
    const firstTool = (await page.getByTestId('upgrade').boundingBox())!;
    const lastTool = (await page.getByTestId('account').boundingBox())!;
    expect(made.x).toBeCloseTo(footer.x, 0);
    expect(firstTool.y).toBeCloseTo(lastPage.y, 0);
    expect(firstTool.x - (lastPage.x + lastPage.width)).toBeLessThanOrEqual(4);
    expect(lastTool.x + lastTool.width).toBeGreaterThanOrEqual(footer.x + footer.width);
  });

  test('pointing at a footer icon shows its name over it', async ({ page }) => {
    await openEditor(page);
    const tip = page.getByTestId('tip');
    await expect(tip).toHaveCount(0);
    const names: [string, string][] = [
      ['nav-about', 'About'],
      ['nav-docs', 'Docs'],
      ['nav-manifesto', 'Manifesto'],
      ['nav-credits', 'Credits'],
      ['nav-policies', 'Policies'],
      ['upgrade', 'Upgrade'],
      ['cart', 'Cart'],
      ['settings', 'Settings'],
      ['account', 'Account'],
    ];
    for (const [id, name] of names) {
      const icon = page.getByTestId(id);
      await icon.hover();
      await expect(tip).toHaveText(name);
      const over = (await tip.boundingBox())!;
      const under = (await icon.boundingBox())!;
      expect(over.y + over.height).toBeLessThanOrEqual(under.y + 1);
      // The tip is for the eye: a screen reader has the icon's own name and is not told twice.
      await expect(icon).not.toHaveAttribute('aria-describedby');
      await expect(tip).toHaveAttribute('aria-hidden', 'true');
    }
    await page.getByTestId('machine').hover();
    await expect(tip).toHaveCount(0);
  });

  test('a tip shows for the keyboard too, and goes when its modal opens', async ({ page }) => {
    await openEditor(page);
    const tip = page.getByTestId('tip');
    await page.locator('.sb-made a').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('nav-about')).toBeFocused();
    await expect(tip).toHaveText('About');

    await page.getByTestId('settings').hover();
    await expect(tip).toHaveText('Settings');
    await page.getByTestId('settings').click();
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await expect(tip).toHaveCount(0);
  });

  test('each footer icon moves when it is pointed at', async ({ page }) => {
    await openEditor(page);
    // These hold a pose for as long as the pointer stays.
    for (const id of ['nav-manifesto', 'cart', 'settings']) {
      const drawing = page.getByTestId(id).locator('svg');
      expect(await drawing.evaluate((node) => getComputedStyle(node).transform)).toBe('none');
      await page.getByTestId(id).hover();
      await expect.poll(() => drawing.evaluate((node) => getComputedStyle(node).transform)).not.toBe('none');
    }
    // These play once: one shape inside the icon is animated.
    const played: [string, number][] = [
      ['nav-about', 3],
      ['nav-docs', 2],
      ['nav-credits', 1],
      ['nav-policies', 3],
      ['upgrade', 1],
      ['account', 2],
    ];
    for (const [id, shape] of played) {
      const part = page.getByTestId(id).locator(`svg > :nth-child(${shape})`);
      expect(await part.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
      await page.getByTestId(id).hover();
      expect(await part.evaluate((node) => getComputedStyle(node).animationName)).toMatch(/^sb-ico-/);
    }
  });

  test('says once what it keeps in the browser, without covering anything', async ({ page }) => {
    await openEditor(page);
    const notice = page.getByTestId('cookie-notice');
    await expect(notice).toContainText('one cookie keeps you logged in');
    // It is part of the page, between the machine and the footer.
    const box = (await notice.boundingBox())!;
    const panel = (await page.getByTestId('panel').boundingBox())!;
    const footer = (await page.locator('.sb-footer').boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(panel.y + panel.height);
    expect(footer.y).toBeGreaterThanOrEqual(box.y + box.height);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((violation) => violation.id)).toEqual([]);

    await page.getByTestId('cookie-notice-ok').click();
    await expect(notice).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('editor')).toBeVisible();
    await expect(notice).toHaveCount(0);
  });

  for (const [id, heading] of [
    ['about', 'About boombapbot'],
    ['docs', 'How to use РИТМ-12'],
    ['manifesto', 'Stay Stoked, Stay Woke'],
    ['credits', 'Credits'],
    ['policies', 'Policies'],
  ] as const) {
    test(`the ${id} page is a page of its own with the same header and footer`, async ({ page }) => {
      await openEditor(page);
      await page.getByTestId(`nav-${id}`).click();
      await expect(page).toHaveURL(new RegExp(`/${id}/?$`));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByTestId(`nav-${id}`)).toHaveAttribute('aria-current', 'page');
      // No machine and no settings here, but the cart and account are.
      await expect(page.getByTestId('panel')).toHaveCount(0);
      await expect(page.getByTestId('settings')).toHaveCount(0);
      await page.getByTestId('account').click();
      await expect(page.getByTestId('account-modal')).toBeVisible();
      await page.keyboard.press('Escape');
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
      // The page does not scroll sideways, and the brand leads back to the machine.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.getByRole('link', { name: 'boombapbot home, Let’s cook' }).click();
      await expect(page.getByTestId('editor')).toBeVisible();
    });
  }

  test('the policies page says how the shop works before anything can be bought', async ({ page }) => {
    await page.goto('/policies');
    const shop = page.locator('h2', { hasText: 'The shop' }).locator('xpath=following-sibling::ul[1]');
    await expect(shop).toContainText('printed to order');
    await expect(shop).toContainText('tell me within 30 days');
    await expect(shop).toContainText('Stripe');
    await expect(shop).toContainText('Printful');
    await expect(shop).toContainText("I don't collect sales tax or VAT");
  });

  test('the policies page says what stays in the browser and what a saved beat keeps', async ({ page }) => {
    await page.goto('/policies');
    const privacy = page.locator('h2', { hasText: 'Privacy' }).locator('xpath=following-sibling::ul[1]');
    await expect(privacy).toContainText('Your work stays in your browser unless you save it to your account.');
    await expect(privacy).toContainText('With no account, or with one you never save a beat to, they are not sent anywhere.');
    await expect(privacy).toContainText('If you save a beat to your account, I keep that beat.');
    await expect(privacy).toContainText('Nothing goes there until you press save');
    await expect(privacy).toContainText('an account holds up to 20 beats');
    await expect(privacy).toContainText('No sound is uploaded.');
  });
});
