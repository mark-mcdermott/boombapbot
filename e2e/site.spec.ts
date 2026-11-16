import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { debug, openEditor, project, stepButton, stepsOn } from './helpers';

test.describe('the power switch', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test('switches the machine off: it stops, goes dark and answers nothing', async ({ page }) => {
    const editor = page.getByTestId('editor');
    const panel = page.getByTestId('panel');
    const power = page.getByTestId('panel-power');
    await expect(power).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('panel-toggle').click();
    await expect(editor).toHaveAttribute('data-playing', 'true');
    const before = await project(page);

    await power.click();
    await expect(power).toHaveAttribute('aria-checked', 'false');
    await expect(editor).toHaveAttribute('data-playing', 'false');
    await expect(panel).toHaveAttribute('data-power', 'off');
    // Every lamp is dark, though the steps are still written.
    const lit = await panel
      .locator('.sb-panel-led')
      .evaluateAll((lamps) => lamps.filter((lamp) => getComputedStyle(lamp).boxShadow.includes('1cqw') || getComputedStyle(lamp).backgroundImage !== 'none').length);
    expect(lit).toBe(0);
    // Nothing else can be pressed, by pointer or keyboard, and Space does not start it.
    await expect(panel.locator('.sb-panel-controls')).toHaveAttribute('inert', '');
    await expect(page.locator('.sb-panel-touch')).toHaveAttribute('inert', '');
    // Space on the switch itself would work it, so leave it first.
    await power.blur();
    await page.locator('body').press('Space');
    await expect(editor).toHaveAttribute('data-playing', 'false');
    await expect(power).toHaveAttribute('aria-checked', 'false');
    expect(await project(page)).toEqual(before);

    // On again, it is as it was.
    await power.focus();
    await page.keyboard.press('Enter');
    await expect(power).toHaveAttribute('aria-checked', 'true');
    await expect(panel).toHaveAttribute('data-power', 'on');
    await expect(panel.locator('.sb-panel-controls')).not.toHaveAttribute('inert', '');
    await stepButton(page, 1).click();
    expect(stepsOn(await project(page), 'kick')).toContain(1);
    await page.getByTestId('panel-toggle').click();
    await expect(editor).toHaveAttribute('data-playing', 'true');
    await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
  });
});

test.describe('dials and cursors', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  /** A point on a dial's rim, at an angle in degrees clockwise from straight up. */
  const rim = async (page: import('@playwright/test').Page, testId: string, deg: number) => {
    const box = (await page.getByTestId(testId).boundingBox())!;
    const radius = box.width * 0.4;
    const angle = (deg * Math.PI) / 180;
    return { x: box.x + box.width / 2 + radius * Math.sin(angle), y: box.y + box.height / 2 - radius * Math.cos(angle) };
  };

  test('the mode and instrument dials turn to where they are pressed or dragged', async ({ page }) => {
    // Manual play is the fourth position, a little right of straight up.
    const manual = await rim(page, 'panel-dial-mode', 24);
    await page.mouse.click(manual.x, manual.y);
    expect((await project(page)).panel.mode).toBe('manual_play');
    await expect(page.getByTestId('panel-mode-manual_play')).toHaveAttribute('aria-checked', 'true');

    // Dragged round to the left it ends on pattern clear.
    await page.mouse.move(manual.x, manual.y);
    await page.mouse.down();
    for (const deg of [0, -30, -60, -90]) {
      const point = await rim(page, 'panel-dial-mode', deg);
      await page.mouse.move(point.x, point.y);
    }
    await page.mouse.up();
    expect((await project(page)).panel.mode).toBe('pattern_clear');

    // The instrument dial: the snare is its third position.
    await page.getByTestId('panel-mode-write_first').click();
    const selector = (await project(page)).panel.selector;
    const top = await rim(page, 'panel-dial-voice', 0);
    await page.mouse.click(top.x, top.y);
    const picked = (await project(page)).panel.selector;
    expect(picked).not.toBe(selector);
    await expect(page.locator('[data-testid^="panel-voice-"][aria-checked="true"]')).toHaveCount(1);
  });

  test('knobs that turn freely show up and down arrows, and those with positions a hand', async ({ page }) => {
    const cursor = (testId: string) => page.getByTestId(testId).evaluate((node) => getComputedStyle(node).cursor);
    for (const id of ['panel-tempo', 'panel-fine', 'panel-master', 'panel-knob-kick-level', 'panel-knob-snare-snappy']) {
      expect(await cursor(id), id).toBe('ns-resize');
    }
    for (const id of [
      'panel-dial-mode',
      'panel-dial-voice',
      'panel-auto-fill',
      'panel-pre-scale',
      'panel-basic-variation',
      'panel-fill-variation',
      'panel-switch-clap',
      'panel-power',
      'panel-tap',
    ]) {
      expect(await cursor(id), id).toBe('pointer');
    }
  });
});

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
    await page.getByTestId('account-close').click();
    await page.getByTestId('cart').click();
    await expect(page.getByTestId('shop-unreachable')).toContainText('The machine does not need it');
  });

  test('the tagline sits under the mascot, and the wordmark beside them', async ({ page }) => {
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
  });

  test('the footer sits 50px under the machine once the notice is closed', async ({ page }) => {
    await openEditor(page);
    const drop = async () => {
      const machine = (await page.getByTestId('hardware').boundingBox())!;
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
    ['docs', 'How to use the 808'],
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
});
