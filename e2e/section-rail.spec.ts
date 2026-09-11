import { test, expect } from './electron-app';
import { type Page } from '@playwright/test';

const RAIL = '[data-testid="section-rail"]';
const BAR = '[data-testid="section-rail-bar"]';
const FLYOUT = '[data-testid="section-rail-flyout"]';

async function createNoteWithHeadings(window: Page, title: string, headings: string[]) {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(350);

  const noteTitle = window.locator('h1.editor-title');
  await noteTitle.click();
  await window.keyboard.type(title);
  await window.keyboard.press('Enter');

  for (const heading of headings) {
    await window.keyboard.type(`# ${heading}`);
    await window.keyboard.press('Enter');
  }
  await window.waitForTimeout(400);
}

/** Types raw markdown lines (e.g. "# H1", "## H2") letting the markdown
 *  shortcuts create the corresponding heading levels. */
async function createNoteWithMarkdownLines(window: Page, title: string, lines: string[]) {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(350);

  const noteTitle = window.locator('h1.editor-title');
  await noteTitle.click();
  await window.keyboard.type(title);
  await window.keyboard.press('Enter');

  for (const line of lines) {
    await window.keyboard.type(line);
    await window.keyboard.press('Enter');
  }
  await window.waitForTimeout(400);
}

/** Builds a tall note (heading + filler paragraphs per section) so the editor
 *  actually scrolls, which the active-bar tracking depends on. */
async function createScrollableNote(window: Page, title: string, headings: string[]) {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(350);

  const noteTitle = window.locator('h1.editor-title');
  await noteTitle.click();
  await window.keyboard.type(title);
  await window.keyboard.press('Enter');

  for (const heading of headings) {
    await window.keyboard.type(`# ${heading}`);
    await window.keyboard.press('Enter');
    for (let i = 0; i < 8; i++) {
      await window.keyboard.type(`filler line ${i} for ${heading}`);
      await window.keyboard.press('Enter');
    }
  }
  await window.waitForTimeout(400);
}

async function scrollActiveMainTo(window: Page, where: 'top' | 'bottom') {
  await window.evaluate((target) => {
    const main = document.querySelector<HTMLElement>('main:not([style*="display: none"])');
    if (!main) return;
    main.scrollTop = target === 'bottom' ? main.scrollHeight : 0;
  }, where);
  await window.waitForTimeout(300);
}

function flyoutPanel(window: Page) {
  return window.locator(`${FLYOUT} > div`);
}

async function openRailFlyout(window: Page) {
  await window.locator(RAIL).hover();
  const flyout = window.locator(FLYOUT);
  await expect(flyout).toBeVisible();
  return flyout;
}

async function mainScrollTop(window: Page): Promise<number> {
  return window
    .locator('main:not([style*="display: none"])')
    .first()
    .evaluate((el) => el.scrollTop);
}

test.describe('Section Rail', () => {
  test('stays hidden when document has fewer than two headings', async ({ window }) => {
    await createNoteWithHeadings(window, 'Rail One Heading', ['Only one']);
    await expect(window.locator(RAIL)).toHaveCount(0);
  });

  test('renders one bar per heading', async ({ window }) => {
    await createNoteWithHeadings(window, 'Rail Bars', ['First', 'Second', 'Third']);
    await expect(window.locator(RAIL)).toBeVisible();
    await expect(window.locator(BAR)).toHaveCount(3);
  });

  test('highlights the first section by default', async ({ window }) => {
    await createNoteWithHeadings(window, 'Rail Active First', ['Intro', 'Middle', 'End']);
    const bars = window.locator(BAR);
    await expect(bars.nth(0)).toHaveAttribute('data-active', 'true');
    await expect(bars.nth(1)).toHaveAttribute('data-active', 'false');
  });

  test('bar width encodes heading level', async ({ window }) => {
    await createNoteWithMarkdownLines(window, 'Rail Widths', ['# Top', '## Middle', '### Leaf']);
    const bars = window.locator(BAR);
    await expect(bars).toHaveCount(3);

    const width = async (index: number) => {
      const box = await bars.nth(index).boundingBox();
      return box?.width ?? 0;
    };

    const h1 = await width(0);
    const h2 = await width(1);
    const h3 = await width(2);
    expect(h1).toBeGreaterThan(h2);
    expect(h2).toBeGreaterThan(h3);
  });

  test('hover reveals a flyout listing the heading titles', async ({ window }) => {
    await createNoteWithHeadings(window, 'Rail Flyout', ['Alpha', 'Beta', 'Gamma']);
    await expect(window.locator(FLYOUT)).toHaveCount(0);

    await window.locator(RAIL).hover();
    const flyout = window.locator(FLYOUT);
    await expect(flyout).toBeVisible();
    await expect(flyout.getByText('Alpha')).toBeVisible();
    await expect(flyout.getByText('Beta')).toBeVisible();
    await expect(flyout.getByText('Gamma')).toBeVisible();
  });

  test('clicking a rail bar jumps the popup directly instead of tracking scroll', async ({ window }) => {
    const many = Array.from({ length: 20 }, (_, i) => `S${i + 1}`);
    await createNoteWithHeadings(window, 'Rail Popup Jump', many);

    await window.locator(RAIL).hover();
    const flyout = window.locator(FLYOUT);
    await expect(flyout).toBeVisible();
    const panel = flyout.locator('> div');

    // Opens centred on the first section.
    await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeLessThan(5);

    // Clicking a far-down bar moves the popup there immediately; it must not
    // wait for / track the note's progressive smooth scroll.
    await window.locator(BAR).nth(18).click();
    const scrollTop = await panel.evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(50);
  });

  test('active bar follows scroll position', async ({ window }) => {
    await createScrollableNote(window, 'Rail Scroll', ['One', 'Two', 'Three', 'Four', 'Five', 'Six']);
    const bars = window.locator(BAR);
    await expect(bars).toHaveCount(6);

    // Typing leaves the caret (and therefore the scroll) at the bottom.
    await scrollActiveMainTo(window, 'top');
    await expect(bars.nth(0)).toHaveAttribute('data-active', 'true');

    await scrollActiveMainTo(window, 'bottom');
    await expect(bars.nth(5)).toHaveAttribute('data-active', 'true');

    await scrollActiveMainTo(window, 'top');
    await expect(bars.nth(0)).toHaveAttribute('data-active', 'true');
  });

  test('clicking a bar scrolls to that section', async ({ window }) => {
    await createScrollableNote(window, 'Rail Jump', ['One', 'Two', 'Three', 'Four', 'Five', 'Six']);
    await scrollActiveMainTo(window, 'top');
    expect(await mainScrollTop(window)).toBe(0);

    await window.locator(BAR).nth(4).click();
    await window.waitForTimeout(600);

    expect(await mainScrollTop(window)).toBeGreaterThan(0);
  });

  test('ignores heading levels below h3', async ({ window }) => {
    await createNoteWithMarkdownLines(window, 'Rail Levels', [
      '# A',
      '#### Deep',
      '## B',
      '##### Deeper',
      '### C',
    ]);

    await expect(window.locator(BAR)).toHaveCount(3);
    const flyout = await openRailFlyout(window);
    await expect(flyout.getByText('Deep', { exact: true })).toHaveCount(0);
    await expect(flyout.getByText('Deeper', { exact: true })).toHaveCount(0);
  });

  test('stays hidden when only h4+ headings are present', async ({ window }) => {
    await createNoteWithMarkdownLines(window, 'Rail Deep Only', ['#### A', '##### B', '###### C']);
    await expect(window.locator(RAIL)).toHaveCount(0);
  });

  test('appears as soon as a second heading is added', async ({ window }) => {
    await createNoteWithHeadings(window, 'Rail Dynamic', ['First']);
    await expect(window.locator(RAIL)).toHaveCount(0);

    await window.keyboard.type('# Second');
    await window.keyboard.press('Enter');

    await expect(window.locator(RAIL)).toBeVisible();
    await expect(window.locator(BAR)).toHaveCount(2);
  });

  test('labels an empty heading as Untitled', async ({ window }) => {
    await createNoteWithHeadings(window, 'Rail Untitled', ['Named']);
    // Create an h2 then delete its text, leaving an empty heading.
    await window.keyboard.type('## Placeholder');
    for (let i = 0; i < 'Placeholder'.length; i++) {
      await window.keyboard.press('Backspace');
    }
    await window.waitForTimeout(300);

    const flyout = await openRailFlyout(window);
    await expect(flyout.getByText('Untitled', { exact: true })).toBeVisible();
  });

  test('indents flyout rows by heading level', async ({ window }) => {
    await createNoteWithMarkdownLines(window, 'Rail Indent', ['# One', '## Two', '### Three']);
    const flyout = await openRailFlyout(window);

    const padding = async (text: string) =>
      parseFloat(
        await flyout
          .getByText(text, { exact: true })
          .evaluate((el) => getComputedStyle(el).paddingLeft),
      );

    const one = await padding('One');
    const two = await padding('Two');
    const three = await padding('Three');
    expect(one).toBeLessThan(two);
    expect(two).toBeLessThan(three);
  });

  test('clicking a flyout row snaps the popup directly', async ({ window }) => {
    const many = Array.from({ length: 20 }, (_, i) => `S${i + 1}`);
    await createNoteWithHeadings(window, 'Rail Row Jump', many);
    const flyout = await openRailFlyout(window);
    const panel = flyoutPanel(window);
    await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeLessThan(5);

    // dispatchEvent skips Playwright's own auto-scroll-into-view, so the jump we
    // observe comes from the app rather than the test harness.
    await flyout.getByText('S19', { exact: true }).dispatchEvent('click');

    await expect(flyout.getByText('S19', { exact: true })).toHaveClass(/accent/);
    expect(await panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(50);
  });

  test('duplicate heading titles navigate to the correct section', async ({ window }) => {
    await createScrollableNote(window, 'Rail Dupes', ['Same', 'Same']);
    await scrollActiveMainTo(window, 'top');

    const flyout = await openRailFlyout(window);
    await flyout.getByText('Same', { exact: true }).last().dispatchEvent('click');
    await window.waitForTimeout(700);
    const secondScroll = await mainScrollTop(window);

    await scrollActiveMainTo(window, 'top');
    await openRailFlyout(window);
    await flyout.getByText('Same', { exact: true }).first().dispatchEvent('click');
    await window.waitForTimeout(700);
    const firstScroll = await mainScrollTop(window);

    expect(firstScroll).toBeLessThan(secondScroll);
  });

  test('stays open when the pointer crosses from the rail to the flyout', async ({ window }) => {
    await createNoteWithHeadings(window, 'Rail Bridge', ['Alpha', 'Beta', 'Gamma']);
    await window.locator(RAIL).hover();
    const flyout = window.locator(FLYOUT);
    await expect(flyout).toBeVisible();

    const railBox = (await window.locator(RAIL).boundingBox())!;
    const flyBox = (await flyout.boundingBox())!;
    await window.mouse.move(railBox.x + railBox.width / 2, railBox.y + railBox.height / 2);
    await window.mouse.move(flyBox.x + flyBox.width / 2, flyBox.y + flyBox.height / 2, {
      steps: 20,
    });

    await expect(flyout).toBeVisible();
  });

  test('closes when the pointer leaves the rail', async ({ window }) => {
    await createNoteWithHeadings(window, 'Rail Leave', ['Alpha', 'Beta']);
    await window.locator(RAIL).hover();
    await expect(window.locator(FLYOUT)).toBeVisible();

    await window.mouse.move(10, 10);
    await expect(window.locator(FLYOUT)).toHaveCount(0);
  });

  test('activates a bar with the keyboard', async ({ window }) => {
    await createScrollableNote(window, 'Rail Keyboard', ['One', 'Two', 'Three', 'Four', 'Five']);
    await scrollActiveMainTo(window, 'top');

    await window.locator(BAR).nth(3).focus();
    await window.keyboard.press('Enter');
    await window.waitForTimeout(600);

    expect(await mainScrollTop(window)).toBeGreaterThan(0);
  });

  test('renders a large heading list with a scrollable flyout', async ({ window }) => {
    const many = Array.from({ length: 30 }, (_, i) => `S${i + 1}`);
    await createNoteWithHeadings(window, 'Rail Many', many);
    await expect(window.locator(BAR)).toHaveCount(30);

    const panel = flyoutPanel(window);
    await openRailFlyout(window);
    const dimensions = await panel.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  });
});
