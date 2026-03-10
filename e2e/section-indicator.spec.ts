import { test, expect } from './electron-app';

const SECTION_TRIGGER = '[aria-label="Navigate sections"]';

async function createNoteWithHeadings(
  window: any,
  title: string,
  headings: string[],
) {
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

test.describe('Section Indicator', () => {
  test('stays hidden when document has fewer than two headings', async ({ window }) => {
    await createNoteWithHeadings(window, 'One Heading', ['Only one']);
    await expect(window.locator(SECTION_TRIGGER)).toHaveCount(0);
  });

  test('opens and closes on click, with active state while open', async ({ window }) => {
    await createNoteWithHeadings(window, 'Two Headings', ['First', 'Second']);
    const trigger = window.locator(SECTION_TRIGGER);

    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(trigger).toHaveClass(/bg-\[#C14B55\]\/15/);
    await expect(window.getByRole('button', { name: 'First', exact: true })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Second', exact: true })).toBeVisible();

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(window.getByRole('button', { name: 'First', exact: true })).toHaveCount(0);
  });

  test('closes on outside click and Escape', async ({ window }) => {
    await createNoteWithHeadings(window, 'Close Cases', ['Alpha', 'Beta']);
    const trigger = window.locator(SECTION_TRIGGER);

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await window.locator('h1.editor-title').click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await window.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('clicking a section row keeps indicator active and menu stable', async ({ window }) => {
    await createNoteWithHeadings(window, 'Row Click', ['First row', 'Second row']);
    const trigger = window.locator(SECTION_TRIGGER);

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await window.getByRole('button', { name: 'Second row', exact: true }).click();
    await window.waitForTimeout(250);

    // Menu remains open after section navigation click.
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(window.getByRole('button', { name: 'First row', exact: true })).toBeVisible();
  });

  test('rapid click toggling keeps state consistent', async ({ window }) => {
    await createNoteWithHeadings(window, 'Rapid Toggle', ['One', 'Two']);
    const trigger = window.locator(SECTION_TRIGGER);

    for (let i = 0; i < 8; i++) {
      await trigger.click();
      await window.waitForTimeout(40);
    }

    // Even number of toggles: should end closed.
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
