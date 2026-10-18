import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { editor, floats } from '../helpers/selectors';

async function selectSourceText(page: Page, text?: string) {
    await page.locator(editor.paragraph).first().click();
    await page.evaluate((selectedText) => {
        const block = window.muya!.editor.scrollPage!.firstContentInDescendant()!;
        const start = selectedText === undefined ? 0 : block.text.indexOf(selectedText);
        if (start < 0)
            throw new Error(`Selection text not found: ${selectedText}`);
        const end = selectedText === undefined ? block.text.length : start + selectedText.length;
        block.setCursor(start, end, true);
    }, text);
    await page.keyboard.press('Shift');
    await expect(page.locator(floats.inlineFormatToolbar)).toBeVisible();
}

async function openPalette(page: Page, name: '文字颜色' | '背景颜色') {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.getAttribute('aria-expanded') !== 'true')
        await button.click();
}

async function chooseColor(page: Page, name: '文字颜色' | '背景颜色', color: string) {
    await openPalette(page, name);
    await page.getByRole('button', { name: `${name} ${color}`, exact: true }).click();
}

function styledText(page: Page, text: string) {
    return page.locator(`${editor.paragraph} ${editor.rawHtml}[style]`).filter({ hasText: text });
}

async function reopenMarkdown(page: Page) {
    const markdown = await getMarkdown(page);
    await page.evaluate(value => window.muya!.setContent(value), markdown);
    expect(await getMarkdown(page)).toBe(markdown);
    await expect(page.locator(editor.htmlBlock)).toHaveCount(0);
    return markdown;
}

test.describe('text color and paragraph toolbar', () => {
    test('palette buttons apply both CSS colors and retain them after reopening Markdown', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('colored text'));
        await selectSourceText(page);
        await expect(page.locator(`${floats.inlineFormatToolbar} li.item.link`)).toHaveCount(0);
        await expect(page.locator(`${floats.inlineFormatToolbar} li.item.image`)).toHaveCount(0);
        await chooseColor(page, '文字颜色', '#E0190F');
        await expect(styledText(page, 'colored text')).toHaveCSS('color', 'rgb(224, 25, 15)');

        await chooseColor(page, '背景颜色', '#FFF3A3');
        const run = styledText(page, 'colored text');
        await expect(run).toHaveCSS('color', 'rgb(224, 25, 15)');
        await expect(run).toHaveCSS('background-color', 'rgb(255, 243, 163)');

        const markdown = await reopenMarkdown(page);
        expect(markdown).toContain('color:#e0190f');
        expect(markdown).toContain('background-color:#fff3a3');
        await expect(run).toHaveCSS('color', 'rgb(224, 25, 15)');
        await expect(run).toHaveCSS('background-color', 'rgb(255, 243, 163)');
        await expect(page.locator(editor.paragraph)).toHaveCount(1);
    });

    test('recoloring replaces the previous color and clearing one property preserves the other', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('keep my highlight'));
        await selectSourceText(page);
        await chooseColor(page, '文字颜色', '#E0190F');
        await chooseColor(page, '背景颜色', '#FFF3A3');
        await chooseColor(page, '文字颜色', '#00A6B2');

        const run = styledText(page, 'keep my highlight');
        await expect(run).toHaveCount(1);
        await expect(run).toHaveCSS('color', 'rgb(0, 166, 178)');
        await expect(run).toHaveCSS('background-color', 'rgb(255, 243, 163)');
        expect(await getMarkdown(page)).not.toContain('#e0190f');

        await page.getByRole('button', { name: '清除文字颜色', exact: true }).click();
        await expect(run).toHaveCSS('background-color', 'rgb(255, 243, 163)');
        expect(await getMarkdown(page)).not.toContain('color:#00a6b2');
        await expect(run).not.toHaveAttribute('style', /(?:^|;)\s*color:/);

        await chooseColor(page, '背景颜色', '#C9E4FF');
        await expect(run).toHaveCSS('background-color', 'rgb(201, 228, 255)');
        await page.getByRole('button', { name: '清除背景颜色', exact: true }).click();
        expect((await getMarkdown(page)).trim()).toBe('keep my highlight');
        await expect(page.locator(`${editor.paragraph} ${editor.rawHtml}[style]`)).toHaveCount(0);
    });

    test('custom color inputs preserve the selection while they receive focus', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('before selected after'));
        await selectSourceText(page, 'selected');
        await openPalette(page, '文字颜色');
        const foregroundInput = page.getByLabel('自选文字颜色', { exact: true });
        await foregroundInput.focus();
        await expect(foregroundInput).toBeFocused();
        await foregroundInput.fill('#123456');
        const run = styledText(page, 'selected');
        await expect(run).toHaveText('selected');
        await expect(run).toHaveCSS('color', 'rgb(18, 52, 86)');

        await openPalette(page, '背景颜色');
        const backgroundInput = page.getByLabel('自选背景颜色', { exact: true });
        await backgroundInput.focus();
        await expect(backgroundInput).toBeFocused();
        await backgroundInput.fill('#abcdef');
        await expect(run).toHaveCSS('color', 'rgb(18, 52, 86)');
        await expect(run).toHaveCSS('background-color', 'rgb(171, 205, 239)');
        expect(await getMarkdown(page)).toMatch(/^before <span[^>]+>selected<\/span> after\n$/);
    });

    test('each color change can be undone and redone independently', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('undo colors'));
        const original = await getMarkdown(page);
        await selectSourceText(page);
        await chooseColor(page, '文字颜色', '#E0190F');
        const foregroundOnly = await getMarkdown(page);
        await chooseColor(page, '背景颜色', '#FFF3A3');
        const bothColors = await getMarkdown(page);

        await page.evaluate(() => window.muya!.undo());
        expect(await getMarkdown(page)).toBe(foregroundOnly);
        await expect(styledText(page, 'undo colors')).toHaveCSS('color', 'rgb(224, 25, 15)');
        await expect(styledText(page, 'undo colors')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await page.evaluate(() => window.muya!.undo());
        expect(await getMarkdown(page)).toBe(original);
        await page.evaluate(() => window.muya!.redo());
        expect(await getMarkdown(page)).toBe(foregroundOnly);
        await page.evaluate(() => window.muya!.redo());
        expect(await getMarkdown(page)).toBe(bothColors);
        await expect(styledText(page, 'undo colors')).toHaveCSS('background-color', 'rgb(255, 243, 163)');
    });

    test('partial selection inside bold colored text keeps its bold and unselected color', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('before <span style="color:#245bdb">**bold word**</span> after'));
        await selectSourceText(page, 'word');
        await chooseColor(page, '背景颜色', '#FFF3A3');

        const strong = page.locator(`${editor.paragraph} strong`);
        const selectedRun = strong.locator(`${editor.rawHtml}[style]`).filter({ hasText: 'word' });
        const unselectedRun = strong.locator(`${editor.rawHtml}[style]`).filter({ hasText: 'bold ' });
        await expect(selectedRun).toHaveText('word');
        await expect(selectedRun).toHaveCSS('color', 'rgb(36, 91, 219)');
        await expect(selectedRun).toHaveCSS('background-color', 'rgb(255, 243, 163)');
        await expect(unselectedRun).toHaveCSS('color', 'rgb(36, 91, 219)');
        await expect(unselectedRun).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(strong.locator(`${editor.rawHtml}[style]`)).toHaveText(['bold ', 'word']);

        await reopenMarkdown(page);
        await expect(selectedRun).toHaveCSS('background-color', 'rgb(255, 243, 163)');
        await expect(unselectedRun).toHaveCSS('color', 'rgb(36, 91, 219)');
        await expect(strong.locator(`${editor.rawHtml}[style]`)).toHaveText(['bold ', 'word']);
    });

    test('a centered colored paragraph stays editable with Markdown emphasis after reopening', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('before **bold** after'));
        await selectSourceText(page);
        await chooseColor(page, '文字颜色', '#E0190F');
        await page.getByRole('button', { name: '居中对齐', exact: true }).click();
        const aligned = page.locator(`${editor.paragraph} ${editor.rawHtml}[style*="text-align"]`);
        await expect(aligned).toHaveCSS('text-align', 'center');
        await expect(aligned).toHaveCSS('display', 'block');

        const markdown = await reopenMarkdown(page);
        expect(markdown).toContain('text-align:center');
        expect(markdown).toContain('**');
        await expect(aligned).toHaveCSS('text-align', 'center');
        await expect(page.locator(`${editor.paragraph} strong ${editor.rawHtml}[style]`)).toHaveCSS('color', 'rgb(224, 25, 15)');
        await expect(page.locator(`${editor.paragraph} strong ${editor.rawHtml}[style]`)).toHaveText('bold');
        expect(await page.evaluate(() => window.muya!.editor.scrollPage!.firstContentInDescendant()!.blockName)).toBe('paragraph.content');

        await selectSourceText(page, 'after');
        await page.keyboard.insertText('updated');
        await expect(aligned).toContainText('updated');
        expect(await getMarkdown(page)).toContain('updated');
        await expect(aligned).toHaveCSS('text-align', 'center');
        await expect(page.locator(editor.htmlBlock)).toHaveCount(0);
    });
});
