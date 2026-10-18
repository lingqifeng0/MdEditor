import type { VNode } from 'snabbdom';
import type { Muya } from '../../index';
import type { Token } from '../../inlineRenderer/types';
import type { ISelectionEndpoints } from '../../selection/types';
import type { IBaseOptions } from '../types';

import type { FormatToolIcon } from './config';
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import Content from '../../block/base/content';
import Format from '../../block/base/format';
import { getCursorReference } from '../../selection';
import { isHTMLElement, isKeyboardEvent, isMouseEvent } from '../../utils';
import { h, patch } from '../../utils/snabbdom';
import BaseFloat from '../baseFloat';
import { readCurrentColors, saveCurrentColors, ToolbarColorPalette } from './colorPalette';
import icons from './config';
import { toolbarGlyph } from './glyphs';
import backgroundIcon from './icons/background-color.svg?url';
import codeblockIcon from './icons/codeblock.svg?url';
import fontColorIcon from './icons/font-color.svg?url';
import mathblockIcon from './icons/mathblock.svg?url';
import tableIcon from './icons/table.svg?url';
import './index.css';

/** Default float options for inline format toolbar */
const defaultOptions = {
    placement: 'top' as const,
    offsetOptions: {
        mainAxis: 5,
        crossAxis: 0,
        alignmentAxis: 0,
    },
    showArrow: false,
};

/** Format keyboard shortcuts without shift modifier */
const FORMAT_SHORTCUTS = {
    b: 'strong',
    i: 'em',
    u: 'u',
    d: 'del',
    e: 'inline_code',
} as const;

/** Format keyboard shortcuts with shift modifier */
const FORMAT_SHORTCUTS_SHIFT = {
    h: 'mark',
    e: 'inline_math',
    r: 'clear',
} as const;

/** Keys that should not trigger toolbar hiding */
const NON_EDITING_KEYS = new Set([
    'Shift',
    'Control',
    'Meta',
    'Alt',
    'Tab',
]);

type ColorProperty = 'color' | 'background-color';
type Alignment = 'left' | 'center' | 'right' | 'justify';

interface IToolbarSelection extends ISelectionEndpoints {
    anchor: ISelectionEndpoints['anchor'] & { block: Content };
    focus: ISelectionEndpoints['focus'] & { block: Content };
    isSelectionInSameBlock: boolean;
}

interface IFormatToolbarOptions extends IBaseOptions {
    getButtonOrder?: () => readonly string[];
}

/**
 * Inline format toolbar for text formatting
 * Provides quick access to text formatting options like bold, italic, etc.
 * Appears when text is selected
 */
export class InlineFormatToolbar extends BaseFloat {
    static pluginName = 'formatPicker';
    // Passive float: must not capture nav keys, or Enter over a selection is
    // swallowed while it's shown (#3196).
    public override capturesContentKeydown = false;

    /** Previous virtual node for patching */
    private _oldVNode: VNode | null = null;

    /** The block containing the selected text */
    private _block: Content | null = null;

    /** Currently applied formats in the selection */
    private _formats: Token[] = [];

    /** Toolbar configuration options */
    public override options: IFormatToolbarOptions;

    /** Format tool icons configuration */
    private _icons: FormatToolIcon[] = icons;

    /** Container element for the format toolbar */
    private _formatContainer: HTMLDivElement = document.createElement('div');

    private _activePalette: ColorProperty | null = null;
    private _activeMenu: 'heading' | 'table' | null = null;
    private _menuCleanup: (() => void) | null = null;
    private _menuElement: HTMLElement | null = null;
    private _tableRows = 3;
    private _tableColumns = 3;
    private _palette = new ToolbarColorPalette(
        (property, color) => this._applyColor(property, color),
        () => this._render(),
        () => {
            this._activePalette = null;
            this._palette.hide();
            this._render();
        },
    );

    private _colors = readCurrentColors();
    private _selectionRange: ISelectionEndpoints | null = null;
    private _dismissedSelection: ISelectionEndpoints | null = null;
    private _selecting = false;
    private _finishedPointerSelection = false;
    private _selectionFrame: number | null = null;

    /**
     * Create inline format toolbar instance
     * @param muya - Muya editor instance
     * @param options - Toolbar options
     */
    constructor(muya: Muya, options: Partial<IFormatToolbarOptions> = {}) {
        const name = 'mu-format-picker';
        const opts = Object.assign({}, defaultOptions, options);
        super(muya, name, opts);
        this.options = opts;
        this.container!.appendChild(this._formatContainer);
        this.floatBox!.classList.add('mu-format-picker-container');
        this.listen();
    }

    /**
     * Listen to format picker events and keyboard shortcuts
     */
    override listen() {
        const { eventCenter, domNode, editor } = this.muya;
        super.listen();

        eventCenter.subscribe('muya-format-picker', ({ reference }) => {
            if (this._keepAttachedPopup())
                return;
            if (reference && !this._selecting)
                this._refreshSelection();
            else if (!reference)
                this._hideTransiently();
        });

        // Menu and API formatting can change the selection without a mouse event.
        eventCenter.subscribe('selection-change', ({ formats, isCollapsed, isSelectionInSameBlock }) => {
            if (!this.status || isCollapsed || this._keepAttachedPopup())
                return;

            this._formats = isSelectionInSameBlock ? formats : [];
            this._rememberSelection();
            this._render();
        });

        eventCenter.attachDOMEvent(domNode, 'keydown', (event) => {
            this._handleKeydown(event, editor);
        });

        eventCenter.attachDOMEvent(domNode, 'mousedown', (event) => {
            if (isMouseEvent(event) && event.button === 0) {
                this._dismissedSelection = null;
                this._selecting = true;
                this.hide();
                const selected = window.getSelection();
                const target = event.target;
                const dragTarget = target instanceof Element && target.closest('img, [draggable="true"]');
                // Clear the previous native range before Chromium chooses text
                // dragging on Windows, so this gesture starts a new selection.
                if (!event.defaultPrevented && event.detail < 3 && !event.shiftKey && !dragTarget && selected && !selected.isCollapsed
                    && domNode.contains(selected.anchorNode) && domNode.contains(selected.focusNode)) {
                    selected.removeAllRanges();
                }
            }
        });
        eventCenter.attachDOMEvent(document, 'mousedown', () => {
            this._finishedPointerSelection = false;
        });
        // A drag ending outside the editor has no click event on its block.
        eventCenter.attachDOMEvent(document, 'mouseup', (event) => {
            if (!isMouseEvent(event) || event.button !== 0 || !this._selecting)
                return;
            this._selecting = false;
            this._finishedPointerSelection = true;
            this._refreshSelection();
        });
        eventCenter.attachDOMEvent(document, 'selectionchange', () => {
            if (this._selecting || this._selectionFrame !== null)
                return;
            this._selectionFrame = requestAnimationFrame(() => {
                this._selectionFrame = null;
                this._refreshSelection();
            });
        });
        eventCenter.attachDOMEvent(domNode, 'keyup', () => this._refreshSelection());
    }

    /** Observes a finished native selection without rewriting the editor's DOM or source. */
    private _refreshSelection() {
        if (this._selecting || this._keepAttachedPopup() || this.floatBox?.contains(document.activeElement))
            return;
        const activeElement = document.activeElement;
        if (activeElement && activeElement !== document.body && !this.muya.domNode.contains(activeElement)) {
            this.hide();
            return;
        }
        if (this._selectionFrame !== null) {
            cancelAnimationFrame(this._selectionFrame);
            this._selectionFrame = null;
        }
        const selected = this._getTextSelection();
        if (!selected) {
            this._hideTransiently();
            return;
        }
        if (this._sameSelection(selected, this._dismissedSelection)) {
            return;
        }
        this._dismissedSelection = null;
        const reference = getCursorReference();
        if (!reference) {
            this._hideTransiently();
            return;
        }
        this._block = selected.anchor.block;
        this._rememberSelection();
        this._formats = selected.isSelectionInSameBlock && this._block instanceof Format ? this._block.getFormatsInRange().formats : [];
        this._render();
        if (this.floatBox && this.container) {
            Object.assign(this.floatBox.style, {
                width: `${this.container.offsetWidth}px`,
                height: `${this.container.offsetHeight}px`,
            });
        }
        this.show(reference);
    }

    private _hideTransiently(): void {
        // Chromium can briefly have no range geometry while the block tree
        // changes. That is not an outside click dismissing this selection.
        const dismissed = this._dismissedSelection;
        this.hide();
        this._dismissedSelection = dismissed;
    }

    private _getTextSelection(): IToolbarSelection | null {
        const selected = this.muya.editor.selection.getSelection();
        const anchor = selected?.anchor.block;
        const focus = selected?.focus.block;
        if (!selected || selected.isCollapsed || !(anchor instanceof Content) || !(focus instanceof Content)
            || anchor.muya !== this.muya || focus.muya !== this.muya) {
            return null;
        }
        return {
            anchor: { ...selected.anchor, block: anchor },
            focus: { ...selected.focus, block: focus },
            isSelectionInSameBlock: selected.isSelectionInSameBlock,
        };
    }

    private _keepAttachedPopup(): boolean {
        if (!this._activePalette && !this._activeMenu)
            return false;
        const range = this._selectionRange;
        if (range?.anchor.block.domNode?.isConnected && range.focus.block.domNode?.isConnected)
            return true;
        // A document reload replaces the block tree. Preserve selection through
        // picker focus changes, but never preserve a target from the old tree.
        this._activePalette = null;
        this._activeMenu = null;
        this._palette.hide();
        this._selectionRange = null;
        return false;
    }

    private _sameSelection(selected: ISelectionEndpoints, previous: ISelectionEndpoints | null) {
        return previous !== null && previous.anchor.block === selected.anchor.block && previous.focus.block === selected.focus.block
            && previous.anchor.offset === selected.anchor.offset && previous.focus.offset === selected.focus.offset;
    }

    /**
     * Handle keyboard events for format shortcuts and toolbar hiding
     * @param event - Keyboard event
     * @param editor - Editor instance
     */
    private _handleKeydown(event: Event, editor: typeof this.muya.editor) {
        if (!isKeyboardEvent(event))
            return;

        const { key, shiftKey, metaKey, ctrlKey } = event;
        if (((metaKey || ctrlKey) && key.toLowerCase() === 'a') || (shiftKey && /^(?:Arrow|Home|End)/.test(key)))
            this._dismissedSelection = null;
        const selection = editor.selection.getSelection();
        if (!selection)
            return;

        const { anchor } = selection;
        const anchorBlock = anchor.block;

        // Hide toolbar on editing operations
        if (!(anchorBlock instanceof Format) || (!metaKey && !ctrlKey)) {
            this._hideOnEditingKey(key, metaKey, ctrlKey);
            return;
        }

        // Handle format shortcuts
        this._handleFormatShortcut(event, key, shiftKey);
    }

    /**
     * Hide toolbar when an editing key is pressed
     * @param key - Key name
     * @param metaKey - Meta key state
     * @param ctrlKey - Control key state
     */
    private _hideOnEditingKey(key: string, metaKey: boolean, ctrlKey: boolean) {
        // Don't hide if it's a modifier/navigation key or if format shortcut is pressed
        if (NON_EDITING_KEYS.has(key) || metaKey || ctrlKey)
            return;

        if (this.status) {
            this.hide();
        }
    }

    /**
     * Handle format keyboard shortcuts
     * @param event - Keyboard event
     * @param key - Key name
     * @param shiftKey - Shift key state
     */
    private _handleFormatShortcut(
        event: KeyboardEvent,
        key: string,
        shiftKey: boolean,
    ) {
        const shortcuts = shiftKey ? FORMAT_SHORTCUTS_SHIFT : FORMAT_SHORTCUTS;
        const formatType = shortcuts[key as keyof typeof shortcuts];

        if (formatType) {
            event.preventDefault();
            this.muya.format(formatType);
        }
    }

    /**
     * Render the format toolbar UI
     */
    private _render() {
        const { _icons: icons, _oldVNode: oldVNode, _formatContainer: formatContainer, _formats: formats } = this;
        const { i18n } = this.muya;

        const children = [this._controlItem('codeblock', this._iconNode(codeblockIcon), '切换代码块', () => this._paragraphAction('pre'))];
        children.push(this._controlItem('heading-n', 'Hn⌄', '标题级别 H1–H6', () => this._toggleMenu('heading')));
        children.push(...icons.map(icon => this._createIconItem(icon, formats, i18n)));
        children.push(this._controlItem('table', this._iconNode(tableIcon), '插入表格', () => this._toggleMenu('table')));
        children.push(this._controlItem('mathblock', this._iconNode(mathblockIcon), '切换块公式', () => this._paragraphAction('mathblock')));
        children.push(...this._paragraphTools());
        children.push(this._colorButton('color', fontColorIcon, '字体颜色', this._colors.color));
        children.push(this._colorButton('background-color', backgroundIcon, '背景颜色', this._colors['background-color']));
        const order = this.options.getButtonOrder?.() ?? [];
        const ranks = new Map(order.map((id, index) => [id, index]));
        const sorted = children.map((node, index) => ({ node, rank: ranks.get(String(node.key)) ?? order.length + index }))
            .sort((a, b) => a.rank - b.rank)
            .map(({ node }) => node);
        const rows = [h('ul.mu-inline-tools', sorted)];
        if (this._activePalette)
            rows.push(this._palette.render());
        if (this._activeMenu)
            rows.push(this._menu());
        const vnode = h('div.mu-toolbar-content', {
            attrs: { 'role': 'toolbar', 'aria-label': '文字格式与颜色' },
        }, rows);

        patch(oldVNode || formatContainer, vnode);
        this._oldVNode = vnode;
        if (this._activePalette) {
            this._palette.position(
                this.container!.querySelector(`.${this._activePalette === 'color' ? 'text-color' : 'background-color'} .mu-color-dropdown`),
                this.container!.querySelector('.mu-color-palette'),
            );
        }
        this._positionMenu();
    }

    private _positionMenu(): void {
        const menu = this._activeMenu ? this.container!.querySelector<HTMLElement>('.mu-toolbar-menu') : null;
        if (menu === this._menuElement)
            return;
        this._menuCleanup?.();
        this._menuCleanup = null;
        this._menuElement = menu;
        const button = this.container!.querySelector<HTMLElement>(`.${this._activeMenu === 'heading' ? 'heading-n' : 'table'} button`);
        if (menu && button) {
            this._menuCleanup = autoUpdate(button, menu, () => {
                void computePosition(button, menu, { strategy: 'fixed', placement: 'bottom-start', middleware: [offset(8), flip(), shift({ padding: 12, crossAxis: true })] })
                    .then(({ x, y }) => {
                        if (this._menuElement === menu)
                            Object.assign(menu.style, { left: `${x}px`, top: `${y}px` });
                    });
            });
        }
    }

    private _rememberSelection() {
        const selected = this._getTextSelection();
        if (selected) {
            this._selectionRange = {
                anchor: { ...selected.anchor, path: [...selected.anchor.path] },
                focus: { ...selected.focus, path: [...selected.focus.path] },
            };
        }
    }

    private _restoreSelection() {
        const range = this._selectionRange;
        if (!range || !range.anchor.block.domNode?.isConnected || !range.focus.block.domNode?.isConnected) {
            this.hide();
            return false;
        }
        this.muya.editor.selection.setSelection(range.anchor, range.focus);
        return true;
    }

    private _afterAction() {
        const selected = this._getTextSelection();
        if (selected) {
            this._block = selected.anchor.block;
            this._rememberSelection();
            this._formats = selected.isSelectionInSameBlock && this._block instanceof Format ? this._block.getFormatsInRange().formats : [];
            this._render();
        }
        this._refreshSelection();
    }

    private _toolButton(label: string | VNode, title: string, action: () => void, className = '') {
        return h(`button.mu-toolbar-button${className ? `.${className}` : ''}`, {
            attrs: { 'type': 'button', title, 'aria-label': title },
            on: {
                mousedown: (event) => { event.preventDefault(); },
                click: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    action();
                },
            },
        }, typeof label === 'string' ? label : [label]);
    }

    private _iconNode(url: string): VNode {
        return h('span.mu-toolbar-svg', { style: { 'mask-image': `url(${JSON.stringify(url)})`, '-webkit-mask-image': `url(${JSON.stringify(url)})` } });
    }

    private _controlItem(type: string, label: string | VNode, title: string, action: () => void): VNode {
        return h(`li.item.${type}`, { key: type, attrs: { 'data-toolbar-id': type } }, [this._toolButton(label, title, action)]);
    }

    private _paragraphAction(type: string): void {
        if (!this._restoreSelection())
            return;
        this.muya.flush();
        this.muya.editor.history.cutoff();
        if (type === 'pre' || type === 'mathblock')
            this.muya.toggleSelectedBlock(type === 'pre' ? 'code-block' : 'math-block');
        else
            this.muya.updateParagraph(type);
        this.muya.flush();
        this.muya.editor.history.cutoff();
        this.hide();
    }

    private _toggleMenu(menu: 'heading' | 'table'): void {
        this._rememberSelection();
        this._activePalette = null;
        this._palette.hide();
        this._activeMenu = this._activeMenu === menu ? null : menu;
        this._render();
    }

    private _menu(): VNode {
        if (this._activeMenu === 'heading') {
            return h('div.mu-toolbar-menu.mu-heading-menu', { attrs: { 'role': 'menu', 'aria-label': '标题级别' } }, [
                ...Array.from({ length: 6 }, (_, index) => this._toolButton(`H${index + 1} 标题 ${index + 1}`, `标题 H${index + 1}`, () => this._paragraphAction(`heading ${index + 1}`))),
                this._toolButton('正文', '转换为正文', () => this._paragraphAction('paragraph')),
            ]);
        }
        const numberInput = (name: 'rows' | 'columns', title: string, value: number) => h('label', [title, h('input', {
            attrs: { 'type': 'number', 'min': '1', 'max': '30', 'aria-label': title },
            props: { value },
            on: { change: (event) => {
                const next = Math.max(1, Math.min(30, Number((event.target as HTMLInputElement).value) || 1));
                if (name === 'rows')
                    this._tableRows = next;
                else this._tableColumns = next;
                this._render();
            } },
        })]);
        return h('div.mu-toolbar-menu.mu-table-menu', { attrs: { 'role': 'dialog', 'aria-label': '插入表格' }, on: { click: event => event.stopPropagation() } }, [
            numberInput('rows', '正文行数', this._tableRows),
            numberInput('columns', '列数', this._tableColumns),
            this._toolButton('插入', '确认插入表格', () => {
                if (!this._restoreSelection())
                    return;
                this.muya.flush();
                this.muya.editor.history.cutoff();
                this.muya.createTable({ rows: this._tableRows + 1, columns: this._tableColumns });
                this.muya.flush();
                this.muya.editor.history.cutoff();
                this.hide();
            }),
        ]);
    }

    private _colorButton(property: ColorProperty, icon: string, title: string, color: string) {
        return h(`li.item.mu-color-tool.${property === 'color' ? 'text-color' : 'background-color'}`, {
            key: property === 'color' ? 'text-color' : 'background-color',
            attrs: { title, 'data-current-color': color, 'data-toolbar-id': property === 'color' ? 'text-color' : 'background-color' },
        }, [h('button.mu-toolbar-button.mu-color-button', {
            attrs: { 'type': 'button', 'title': `${title} ${color}（点击应用）`, 'aria-label': `应用当前${title}` },
            on: {
                mousedown: event => event.preventDefault(),
                click: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this._applyColor(property, color);
                },
            },
        }, [this._iconNode(icon), h('span.mu-current-color', { style: { 'background-color': color } })]), h('button.mu-toolbar-button.mu-color-dropdown', {
            attrs: {
                'type': 'button',
                'title': `选择${title}`,
                'aria-label': `选择${title}`,
                'aria-expanded': String(this._activePalette === property),
            },
            on: {
                mousedown: (event) => { event.preventDefault(); },
                click: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this._rememberSelection();
                    this._activeMenu = null;
                    if (this._activePalette === property) {
                        this._activePalette = null;
                        this._palette.hide();
                    }
                    else {
                        this._activePalette = property;
                        this._palette.open(property, this._colors[property]);
                    }
                    this._render();
                },
            },
        }, [h('span.mu-toolbar-dropdown', '⌄')])]);
    }

    private _applyColor(property: ColorProperty, color: string | null) {
        this._activePalette = null;
        this._activeMenu = null;
        this._palette.hide();
        if (!this._restoreSelection())
            return;
        this.muya.applyTextColor(property, color);
        if (color) {
            this._colors[property] = color;
            saveCurrentColors(this._colors);
        }
        this._afterAction();
    }

    private _paragraphTools() {
        const controls: VNode[] = [];

        for (const [type, title] of [
            ['ul-bullet', '无序列表'],
            ['ol-order', '有序列表'],
            ['ul-task', '任务列表'],
            ['blockquote', '引用'],
        ]) {
            controls.push(this._controlItem(type, toolbarGlyph(type), title, () => {
                this._paragraphAction(type);
            }));
        }
        const alignments: Array<[Alignment, string]> = [
            ['left', '左对齐'],
            ['center', '居中对齐'],
            ['right', '右对齐'],
            ['justify', '两端对齐'],
        ];
        for (const [value, title] of alignments) {
            controls.push(this._controlItem(`align-${value}`, toolbarGlyph(value), title, () => {
                if (!this._restoreSelection())
                    return;
                this.muya.alignParagraph(value);
                this._afterAction();
            }));
        }
        controls.push(this._controlItem('undo', toolbarGlyph('undo'), '撤销', () => {
            this.muya.undo();
            this.hide();
        }));
        controls.push(this._controlItem('redo', toolbarGlyph('redo'), '重做', () => {
            this.muya.redo();
            this.hide();
        }));
        return controls;
    }

    private _keepVisibleOnScroll(event: Event): boolean {
        if (!isHTMLElement(event.target))
            return false;
        const reference = this._keepAttachedPopup()
            ? this._selectionRange?.anchor.block.domNode
            : this._getTextSelection() && getCursorReference();
        const rectangle = reference?.getBoundingClientRect();
        const viewport = event.target.getBoundingClientRect();
        return !!rectangle && rectangle.bottom > viewport.top && rectangle.top < viewport.bottom
            && rectangle.right > viewport.left && rectangle.left < viewport.right;
    }

    override hide(event?: Event) {
        // Host typewriter/caret scrolling must not dismiss a visible selection.
        // Floating UI already follows it; close once it leaves the viewport.
        if (event?.type === 'scroll' && this._keepVisibleOnScroll(event))
            return;
        if (event?.type === 'click') {
            const finishedSelection = this._finishedPointerSelection;
            this._finishedPointerSelection = false;
            const selected = this.muya.editor.selection.getSelection();
            if ((finishedSelection || (event.target instanceof Node && this.muya.domNode.contains(event.target)))
                && selected && !selected.isCollapsed && selected.anchor.block.muya === this.muya && selected.focus.block.muya === this.muya) {
                return;
            }
        }
        if (this._selectionFrame !== null) {
            cancelAnimationFrame(this._selectionFrame);
            this._selectionFrame = null;
        }
        const selected = this.muya.editor.selection.getSelection();
        if (!this._selecting && selected && !selected.isCollapsed && selected.anchor.block.muya === this.muya && selected.focus.block.muya === this.muya) {
            this._dismissedSelection = {
                anchor: { ...selected.anchor, path: [...selected.anchor.path] },
                focus: { ...selected.focus, path: [...selected.focus.path] },
            };
        }
        this._activePalette = null;
        this._activeMenu = null;
        this._menuCleanup?.();
        this._menuCleanup = null;
        this._menuElement = null;
        this._palette.hide();
        this._selectionRange = null;
        super.hide();
    }

    override destroy() {
        this.hide();
        super.destroy();
    }

    /**
     * Create a format icon item
     * @param icon - Icon configuration
     * @param formats - Currently applied formats
     * @param i18n - Internationalization instance
     */
    private _createIconItem(icon: FormatToolIcon, formats: Token[], i18n: typeof this.muya.i18n) {
        const iconWrapper = toolbarGlyph(icon.type);

        const isActive = formats.some(
            f => f.type === icon.type || (f.type === 'html_tag' && f.tag === icon.type),
        );

        const itemSelector = `li.item.${icon.type}${isActive ? '.active' : ''}`;

        return h(
            itemSelector,
            {
                key: icon.type,
                attrs: {
                    'data-toolbar-id': icon.type,
                    'title': `${i18n.t(icon.tooltip)}${icon.shortcut ? `\n${icon.shortcut}` : ''}`,
                    'role': 'button',
                    'aria-label': i18n.t(icon.tooltip),
                    'tabindex': '0',
                },
                on: {
                    mousedown: (event) => { event.preventDefault(); },
                    click: event => this._selectItem(event, icon),
                    keydown: (event) => {
                        if (isKeyboardEvent(event) && (event.key === 'Enter' || event.key === ' '))
                            this._selectItem(event, icon);
                    },
                },
            },
            [iconWrapper],
        );
    }

    /**
     * Handle format item selection
     * @param event - Click event
     * @param item - Selected format tool icon
     */
    private _selectItem(event: Event, item: FormatToolIcon) {
        event.preventDefault();
        event.stopPropagation();

        if (!this._restoreSelection())
            return;
        this.muya.flush();
        this.muya.editor.history.cutoff();
        this.muya.format(item.type);
        this.muya.flush();
        this.muya.editor.history.cutoff();
        this._afterAction();
    }
}
