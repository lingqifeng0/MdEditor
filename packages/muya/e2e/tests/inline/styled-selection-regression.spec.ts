import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { metaKey } from '../helpers/keyboard';
import { editor, floats } from '../helpers/selectors';

const STYLED_CHINESE = '<span style="color:#e0190f;background-color:#fff3a3">你好</span>';

async function renderedTextEdges(page: Page, text: string) {
    return page.evaluate(({ rootSelector, wanted }) => {
        const root = document.querySelector(rootSelector)!;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const start = (node.textContent ?? '').indexOf(wanted);
            if (start < 0)
                continue;
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + wanted.length);
            const rect = range.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1)
                continue;
            return {
                start: { x: rect.x + 1, y: rect.y + rect.height / 2 },
                end: { x: rect.right - 1, y: rect.y + rect.height / 2 },
            };
        }
        throw new Error(`Visible text not found: ${wanted}`);
    }, { rootSelector: editor.root, wanted: text });
}

async function dragText(page: Page, text: string, backwards = false, outside = false) {
    const edges = await renderedTextEdges(page, text);
    const from = backwards ? edges.end : edges.start;
    let to = backwards ? edges.start : edges.end;
    if (outside) {
        const root = (await page.locator(editor.root).boundingBox())!;
        to = { x: root.x - 5, y: edges.end.y };
    }
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
}

async function nextFrames(page: Page) {
    await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
}

async function selectionSnapshot(page: Page) {
    return page.evaluate(({ rootSelector, toolbarSelector }) => {
        const muya = window.muya!;
        const root = document.querySelector<HTMLElement>(rootSelector)!;
        const toolbar = document.querySelector<HTMLElement>(toolbarSelector)!;
        const toolbarBox = toolbar.parentElement!;
        const nativeSelection = window.getSelection();
        const cached = muya.editor.selection;
        const leaf = muya.editor.scrollPage!.firstContentInDescendant();
        const scrollParents = [];
        for (let parent: HTMLElement | null = root; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            scrollParents.push({
                tag: parent.tagName,
                className: parent.className,
                scrollTop: parent.scrollTop,
                clientHeight: parent.clientHeight,
                scrollHeight: parent.scrollHeight,
                visibility: style.visibility,
                pointerEvents: style.pointerEvents,
                overflowY: style.overflowY,
                rect: parent.getBoundingClientRect().toJSON(),
            });
        }
        const range = nativeSelection?.rangeCount ? nativeSelection.getRangeAt(0) : null;
        return {
            markdown: muya.getMarkdown(),
            state: muya.getState(),
            leaf: leaf ? { text: leaf.text, name: leaf.blockName } : null,
            rootText: root.textContent,
            rootHTML: root.innerHTML,
            cursorEvents: root.dataset.cursorEvents ? JSON.parse(root.dataset.cursorEvents) : [],
            scrollParents,
            leafRect: leaf?.domNode.getBoundingClientRect().toJSON(),
            native: {
                text: nativeSelection?.toString(),
                anchorOffset: nativeSelection?.anchorOffset,
                focusOffset: nativeSelection?.focusOffset,
                anchorNode: nativeSelection?.anchorNode?.textContent,
                focusNode: nativeSelection?.focusNode?.textContent,
                rangeRects: range ? [...range.getClientRects()].map(rect => rect.toJSON()) : [],
            },
            cached: {
                anchorOffset: cached.anchor?.offset,
                focusOffset: cached.focus?.offset,
                anchorText: cached.anchorBlock?.text,
                focusText: cached.focusBlock?.text,
            },
            toolbar: {
                opacity: getComputedStyle(toolbarBox).opacity,
                rect: toolbarBox.getBoundingClientRect().toJSON(),
            },
        };
    }, { rootSelector: editor.root, toolbarSelector: floats.inlineFormatToolbar });
}

async function attachSnapshot(page: Page, name: string) {
    await nextFrames(page);
    const path = test.info().outputPath(`${name}.json`);
    await writeFile(path, JSON.stringify(await selectionSnapshot(page), null, 2));
    await test.info().attach(name, {
        path,
        contentType: 'application/json',
    });
}

async function expectToolbar(page: Page) {
    await expect(page.getByRole('button', { name: '文字颜色', exact: true })).toBeVisible({ timeout: 750 });
    await expect(page.locator(floats.inlineFormatToolbar).locator('..')).toHaveCSS('opacity', '1', { timeout: 750 });
}

async function darkTheme(page: Page) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addStyleTag({ content: `
        :root {
            --editor-bg-color: #181a1b;
            --editor-color: #ddd;
            --editor-color-80: #eee;
            --editor-color-30: #888;
            --float-bg-color: #25282b;
            --float-border-color: #444;
        }
        body { background: #181a1b; color: #ddd; }
    ` });
}

test.describe('styled Chinese selection regression', () => {
    test('real drag selects plain short Chinese and shows the toolbar without changing text', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.evaluate(() => window.muya!.setContent('你好'));
        const original = await getMarkdown(page);
        await dragText(page, '你好');
        await attachSnapshot(page, 'plain-drag');
        expect(await getMarkdown(page)).toBe(original);
        await expect(page.locator(editor.paragraphContent)).toContainText('你好');
        await expectToolbar(page);
        expect(errors).toEqual([]);
    });

    test('reselecting styled short Chinese in dark mode never changes or blanks the paragraph', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await darkTheme(page);
        await page.evaluate(value => window.muya!.setContent(value), STYLED_CHINESE);
        const original = await getMarkdown(page);
        const originalState = await page.evaluate(() => window.muya!.getState());
        const run = page.locator(`${editor.paragraph} ${editor.rawHtml}[style]`);
        for (let iteration = 0; iteration < 6; iteration++) {
            await dragText(page, '你好', iteration % 2 === 1);
            await attachSnapshot(page, `styled-drag-${iteration}`);
            expect(await getMarkdown(page)).toBe(original);
            expect(await page.evaluate(() => window.muya!.getState())).toEqual(originalState);
            await expect(run).toHaveText('你好');
            await expect(run).toHaveCSS('color', 'rgb(224, 25, 15)');
            await expect(run).toHaveCSS('background-color', 'rgb(255, 243, 163)');
            await expect(run).toBeVisible();
            await expectToolbar(page);
            const edges = await renderedTextEdges(page, '你好');
            await page.mouse.click(edges.end.x, edges.end.y);
        }
        expect(errors).toEqual([]);
    });

    test('real toolbar coloring of short Chinese survives repeated pointer selections', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await darkTheme(page);
        await page.evaluate(() => window.muya!.setContent('你好'));
        await dragText(page, '你好');
        await expectToolbar(page);
        await page.getByRole('button', { name: '文字颜色', exact: true }).click();
        await page.getByRole('button', { name: '文字颜色 #E0190F', exact: true }).click();
        await page.getByRole('button', { name: '背景颜色', exact: true }).click();
        await page.getByRole('button', { name: '背景颜色 #FFF3A3', exact: true }).click();
        const original = await getMarkdown(page);
        for (let iteration = 0; iteration < 4; iteration++) {
            await dragText(page, '你好', iteration % 2 === 1);
            await attachSnapshot(page, `newly-colored-${iteration}`);
            expect(await getMarkdown(page)).toBe(original);
            await expect(page.locator(`${editor.paragraph} ${editor.rawHtml}[style]`)).toHaveText('你好');
            await expectToolbar(page);
        }
        expect(errors).toEqual([]);
    });

    test('releasing a styled text drag outside the editor preserves content and shows the toolbar', async ({ page }) => {
        await page.evaluate(value => window.muya!.setContent(value), STYLED_CHINESE);
        const original = await getMarkdown(page);
        await dragText(page, '你好', true, true);
        await attachSnapshot(page, 'outside-mouseup');
        expect(await getMarkdown(page)).toBe(original);
        await expect(page.locator(`${editor.paragraph} ${editor.rawHtml}[style]`)).toHaveText('你好');
        await expectToolbar(page);
    });

    test('Cmd+A and Shift navigation on a styled paragraph do not mutate or blank its text', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await darkTheme(page);
        await page.evaluate(value => window.muya!.setContent(value), STYLED_CHINESE);
        const original = await getMarkdown(page);
        const edges = await renderedTextEdges(page, '你好');
        await page.mouse.click(edges.start.x, edges.start.y);
        await page.keyboard.press(`${metaKey()}+a`);
        await attachSnapshot(page, 'select-all');
        expect(await getMarkdown(page)).toBe(original);
        await expectToolbar(page);
        await page.keyboard.press('ArrowRight');
        for (let iteration = 0; iteration < 2; iteration++) {
            await page.keyboard.press('Shift+ArrowLeft');
            await attachSnapshot(page, `keyboard-${iteration}`);
            expect(await getMarkdown(page)).toBe(original);
            expect(await page.evaluate(() => window.muya!.getSelectedText())).toBe(iteration === 0 ? '好' : '你好');
            await expect(page.locator(`${editor.paragraph} ${editor.rawHtml}[style]`)).toHaveText('你好');
            await expectToolbar(page);
        }
        expect(errors).toEqual([]);
    });

    test('cross-paragraph dragging styled text preserves both paragraphs and model', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.evaluate(value => window.muya!.setContent(`${value}\n\n后续文字`), STYLED_CHINESE);
        const original = await getMarkdown(page);
        const first = await renderedTextEdges(page, '你好');
        const last = await renderedTextEdges(page, '后续文字');
        await page.mouse.move(first.start.x, first.start.y);
        await page.mouse.down();
        await page.mouse.move(last.end.x, last.end.y, { steps: 12 });
        await page.mouse.up();
        await attachSnapshot(page, 'cross-paragraph');
        expect(await getMarkdown(page)).toBe(original);
        await expect(page.locator(editor.paragraph)).toHaveCount(2);
        await expect(page.locator(`${editor.paragraph} ${editor.rawHtml}[style]`)).toHaveText('你好');
        await expect(page.locator(editor.paragraph).last()).toContainText('后续文字');
        await expectToolbar(page);
        expect(errors).toEqual([]);
    });

    test('a newly empty note can type and select short Chinese without losing it', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.evaluate(() => window.muya!.setContent(''));
        await page.locator(editor.paragraph).click();
        await page.keyboard.insertText('你好');
        await expect(page.locator(editor.paragraphContent)).toContainText('你好');
        await expect.poll(() => getMarkdown(page)).toBe('你好\n');
        const original = await getMarkdown(page);
        await dragText(page, '你好');
        await attachSnapshot(page, 'new-note-drag');
        expect(await getMarkdown(page)).toBe(original);
        await expectToolbar(page);
        expect(errors).toEqual([]);
    });

    test('hidden styled-source markers cannot create selection rectangles below the visible line', async ({ page }) => {
        await darkTheme(page);
        await page.evaluate(value => window.muya!.setContent(value), STYLED_CHINESE);
        await dragText(page, '你好', true, true);
        await attachSnapshot(page, 'hidden-marker-geometry');
        const snapshot = await selectionSnapshot(page);
        expect(snapshot.native.text).toContain('你好');
        const visibleBottom = snapshot.leafRect!.bottom;
        const paintedRects = snapshot.native.rangeRects.filter(rect => rect.width > 0 && rect.height > 0);
        expect(paintedRects.length).toBeGreaterThan(0);
        expect(Math.max(...paintedRects.map(rect => rect.bottom))).toBeLessThanOrEqual(visibleBottom + 2);
        expect(snapshot.markdown).toBe(`${STYLED_CHINESE}\n`);
    });

    test('typewriter host scrolling follows visible Chinese glyphs during backward selection and Home', async ({ page }) => {
        await darkTheme(page);
        await page.addStyleTag({ content: `
            .editor-container {
                height: 500px;
                overflow: auto;
                box-sizing: border-box;
                padding-top: 270px;
                overflow-anchor: none;
            }
            ${editor.root} > div { padding-bottom: 720px; }
        ` });
        await page.evaluate(({ markdown, rootSelector }) => {
            const muya = window.muya!;
            muya.setContent(markdown);
            const root = document.querySelector<HTMLElement>(rootSelector)!;
            const scroll = root.parentElement!;
            const cursorEvents: Array<{ y: number; visibleTop: number; visibleBottom: number; scrollBefore: number; scrollAfter: number }> = [];
            // Desktop typewriter mode centers the caret at viewport y=320.
            muya.on('selection-change', (payload: { cursorCoords?: DOMRect | null }) => {
                const coords = payload.cursorCoords;
                if (!coords)
                    return;
                const visibleRun = root.querySelector<HTMLElement>('span[style]')!;
                const visible = visibleRun.getBoundingClientRect();
                const scrollBefore = scroll.scrollTop;
                if (Math.abs(coords.y - 320) > 2)
                    scroll.scrollTop = scrollBefore + coords.y - 320;
                cursorEvents.push({
                    y: coords.y,
                    visibleTop: visible.top,
                    visibleBottom: visible.bottom,
                    scrollBefore,
                    scrollAfter: scroll.scrollTop,
                });
                root.dataset.cursorEvents = JSON.stringify(cursorEvents);
            });
        }, { markdown: STYLED_CHINESE, rootSelector: editor.root });
        const original = await getMarkdown(page);
        await dragText(page, '你好', true);
        await attachSnapshot(page, 'typewriter-backward');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Home');
        await attachSnapshot(page, 'typewriter-home');
        const snapshot = await selectionSnapshot(page);
        expect(snapshot.markdown).toBe(original);
        await expect(page.locator(`${editor.paragraph} ${editor.rawHtml}[style]`)).toHaveText('你好');
        await expect(page.locator(`${editor.paragraph} ${editor.rawHtml}[style]`)).toBeInViewport();
        expect(snapshot.cursorEvents.length).toBeGreaterThan(0);
        for (const cursor of snapshot.cursorEvents) {
            expect(cursor.y).toBeGreaterThanOrEqual(cursor.visibleTop - 2);
            expect(cursor.y).toBeLessThanOrEqual(cursor.visibleBottom + 2);
        }
    });

    test('Escape dismisses the toolbar until the user creates a new selection', async ({ page }) => {
        await page.evaluate(value => window.muya!.setContent(value), STYLED_CHINESE);
        const original = await getMarkdown(page);
        await dragText(page, '你好');
        await expectToolbar(page);
        await page.keyboard.press('Escape');
        await attachSnapshot(page, 'escape-dismiss');
        await expect(page.locator(floats.inlineFormatToolbar).locator('..')).toHaveCSS('opacity', '0', { timeout: 750 });
        expect(await getMarkdown(page)).toBe(original);
        await dragText(page, '你好', true);
        await expectToolbar(page);
    });

    test('two focused custom color changes retain the entire cross-paragraph selection', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('第一段\n\n第二段'));
        const first = await renderedTextEdges(page, '第一段');
        const last = await renderedTextEdges(page, '第二段');
        await page.mouse.move(first.start.x, first.start.y);
        await page.mouse.down();
        await page.mouse.move(last.end.x, last.end.y, { steps: 12 });
        await page.mouse.up();
        await expectToolbar(page);

        await page.getByRole('button', { name: '文字颜色', exact: true }).click();
        const foreground = page.getByLabel('自选文字颜色', { exact: true });
        await foreground.focus();
        await foreground.fill('#123456');
        await attachSnapshot(page, 'cross-custom-foreground');
        for (const text of ['第一段', '第二段']) {
            const run = page.locator(`${editor.paragraph} ${editor.rawHtml}[style]`).filter({ hasText: text });
            await expect(run).toHaveCSS('color', 'rgb(18, 52, 86)');
        }

        await page.getByRole('button', { name: '背景颜色', exact: true }).click();
        const background = page.getByLabel('自选背景颜色', { exact: true });
        await background.focus();
        await background.fill('#abcdef');
        await attachSnapshot(page, 'cross-custom-background');
        for (const text of ['第一段', '第二段']) {
            const run = page.locator(`${editor.paragraph} ${editor.rawHtml}[style]`).filter({ hasText: text });
            await expect(run).toHaveCSS('color', 'rgb(18, 52, 86)');
            await expect(run).toHaveCSS('background-color', 'rgb(171, 205, 239)');
        }
    });

    test('bold toggle after an outside backward drag keeps balanced color markup and paragraph content', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await darkTheme(page);
        await page.evaluate(value => window.muya!.setContent(value), STYLED_CHINESE);
        await dragText(page, '你好', true, true);
        await expectToolbar(page);
        await page.locator(`${floats.inlineFormatToolbar} li.item.strong`).click();
        const boldMarkdown = await getMarkdown(page);
        expect(boldMarkdown.trim()).toBe(STYLED_CHINESE.replace('你好', '**你好**'));
        const strong = page.locator(`${editor.paragraph} strong`);
        const colored = page.locator(`${editor.paragraph} ${editor.rawHtml}[style]`);
        await expect(strong).toHaveText('你好');
        await expect(strong).toHaveCSS('color', 'rgb(224, 25, 15)');
        await expect(colored).toHaveCSS('background-color', 'rgb(255, 243, 163)');

        await page.evaluate(value => window.muya!.setContent(value), boldMarkdown);
        expect(await getMarkdown(page)).toBe(boldMarkdown);
        await expect(page.locator(editor.paragraph)).toHaveCount(1);
        await expect(page.locator(editor.htmlBlock)).toHaveCount(0);
        await expect(strong).toHaveText('你好');
        await expect(colored).toHaveCSS('color', 'rgb(224, 25, 15)');
        await expect(colored).toHaveCSS('background-color', 'rgb(255, 243, 163)');

        await dragText(page, '你好', true, true);
        await expectToolbar(page);
        await expect(page.getByLabel('段落样式', { exact: true })).toHaveValue('paragraph');
        await page.locator(`${floats.inlineFormatToolbar} li.item.strong`).click();
        await expect.poll(async () => (await getMarkdown(page)).trim()).toBe(STYLED_CHINESE);
        await expect(strong).toHaveCount(0);
        await expect(colored).toHaveText('你好');
        await expect(colored).toHaveCSS('color', 'rgb(224, 25, 15)');
        await expect(colored).toHaveCSS('background-color', 'rgb(255, 243, 163)');
        expect(errors).toEqual([]);
    });
});
