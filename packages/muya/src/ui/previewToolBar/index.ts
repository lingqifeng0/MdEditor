import type { VNode } from 'snabbdom';
import type HTMLBlock from '../../block/commonMark/html';
import type DiagramBlock from '../../block/extra/diagram';
import type MathBlock from '../../block/extra/math';
import type { TBlockPath } from '../../block/types';
import type { Muya } from '../../index';
import type { IPreviewToolIcon } from './config';
import { ScrollPage } from '../../block/scrollPage';
import { BLOCK_DOM_PROPERTY } from '../../config';
import { isKeyboardEvent, isMouseEvent } from '../../utils';
import { findScrollContainer } from '../../utils/dom';
import { requestImageDeletion } from '../../utils/imageDeletion';
import { collectMarkdownImageSources } from '../../utils/imageSources';
import { h, patch } from '../../utils/snabbdom';
import BaseFloat from '../baseFloat';
import { PREVIEW_BLOCK_NAMES, previewToolBarItems } from './config';

import './index.css';

const INSET = 5;

const defaultOptions = {
    placement: 'right-start' as const,
    offsetOptions: {
        mainAxis: 0,
        crossAxis: INSET,
        alignmentAxis: 0,
    },
    showArrow: false,
};

type TPreviewBlock = HTMLBlock | MathBlock | DiagramBlock;

export interface IPreviewDiagramPayload {
    type: string;
    code: string;
    preview: HTMLElement;
    label: string | null;
}

export interface IEditHtmlLayoutPayload {
    html: string;
    preview: HTMLElement;
    blockPath: TBlockPath;
    /** Returns false when the document, block, or source changed while the editor was open. */
    apply: (nextHtml: string) => boolean;
    isValid?: () => boolean;
    /** Restore this block's screen position after the host closes its editing panel. */
    restoreViewport: () => void;
}

export class PreviewToolBar extends BaseFloat {
    static pluginName = 'previewTools';
    private _oldVNode: VNode | null = null;
    private _block: TPreviewBlock | null = null;
    private _iconContainer: HTMLDivElement = document.createElement('div');
    private _hoverFrame: number | null = null;
    private _hoverEvent: MouseEvent | null = null;
    private _destroyed = false;

    constructor(muya: Muya, options = {}) {
        const name = 'mu-preview-tools';
        const opts = Object.assign({}, defaultOptions, options);
        super(muya, name, opts);
        this.options = opts;
        this.container?.appendChild(this._iconContainer);
        this.floatBox?.classList.add('mu-preview-tools-container');
        this.listen();
    }

    override listen() {
        const { eventCenter } = this.muya;
        super.listen();

        const handler = (event: Event) => {
            if (this._destroyed || !isMouseEvent(event))
                return;
            if (event.target instanceof Node && this.floatBox?.contains(event.target)) {
                this._cancelHover();
                return;
            }
            this._hoverEvent = event;
            if (this._hoverFrame !== null)
                return;
            this._hoverFrame = requestAnimationFrame(() => {
                this._hoverFrame = null;
                const latest = this._hoverEvent;
                this._hoverEvent = null;
                if (latest && !this._destroyed)
                    this._updateHover(latest);
            });
        };

        eventCenter.attachDOMEvent(document.body, 'mousemove', handler);
    }

    // The float outlives the hover, and the block it was built for can be
    // deleted while this reference is the only thing still holding its DOM.
    override hide() {
        this._cancelHover();
        super.hide();
        this._block = null;
    }

    private _cancelHover() {
        if (this._hoverFrame !== null)
            cancelAnimationFrame(this._hoverFrame);
        this._hoverFrame = null;
        this._hoverEvent = null;
    }

    private _updateHover(event: MouseEvent) {
        const elements = document.elementsFromPoint(event.clientX, event.clientY);
        if (elements.some(element => this.floatBox?.contains(element)))
            return;
        const container = elements.find(element =>
            this.muya.domNode.contains(element)
            && element[BLOCK_DOM_PROPERTY]
            && PREVIEW_BLOCK_NAMES.has((element[BLOCK_DOM_PROPERTY] as TPreviewBlock).blockName),
        );
        const block = container?.[BLOCK_DOM_PROPERTY] as TPreviewBlock | undefined;
        if (!container || !block || block.active || (block.blockName === 'html-block' && this.muya.options.disableHtml))
            return this.hide();
        if (this._block === block && this.status)
            return;
        this._block = block;
        this.render();
        this._tuckInsideBlock();
        this.show(container);
    }

    override destroy() {
        this._destroyed = true;
        this.hide();
        super.destroy();
    }

    // `right-start` puts the float's left edge on the block's right edge; a
    // negative mainAxis pulls it back inside the block's top-right corner.
    // Measured after `render()` and before `show()`, so the first
    // `computePosition` already sees the width this toolbar will have.
    private _tuckInsideBlock() {
        const width = this.container?.offsetWidth ?? 0;
        if (this.floatBox)
            this.floatBox.style.width = `${width}px`;
        this.options.offsetOptions = {
            mainAxis: -(width + INSET),
            crossAxis: INSET,
            alignmentAxis: 0,
        };
    }

    private _previewNode(): HTMLElement | null {
        return (this._block?.attachments?.head?.domNode as HTMLElement | undefined) ?? null;
    }

    private _items(): IPreviewToolIcon[] {
        const { _block: block } = this;
        if (!block)
            return [];

        const rendered = !!this._previewNode()?.querySelector('svg, img');

        return previewToolBarItems(block.blockName, rendered);
    }

    render() {
        const { _iconContainer: iconContainer, _oldVNode: oldVNode } = this;
        const { i18n } = this.muya;
        const children = this._items().map((i) => {
            const iconWrapperSelector = 'div.icon-wrapper';
            const icon = h(
                'i.icon',
                h(
                    'i.icon-inner',
                    {
                        style: {
                            'background': `url(${JSON.stringify(i.icon)}) no-repeat`,
                            'background-size': '100%',
                        },
                    },
                    '',
                ),
            );
            const iconWrapper = h(iconWrapperSelector, icon);

            const itemSelector = `li.item.${i.type}`;

            return h(
                itemSelector,
                {
                    attrs: {
                        'title': i18n.t(i.tooltip),
                        'role': 'button',
                        'tabindex': '0',
                        'aria-label': this._block?.blockName === 'html-block' && i.type === 'edit'
                            ? '编辑 HTML 布局'
                            : i18n.t(i.tooltip),
                    },
                    on: {
                        mousedown: (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            this._cancelHover();
                        },
                        click: (event) => {
                            this.selectItem(event, i);
                        },
                        keydown: (event) => {
                            if (isKeyboardEvent(event) && (event.key === 'Enter' || event.key === ' '))
                                this.selectItem(event, i);
                        },
                    },
                },
                [iconWrapper],
            );
        });

        const vnode = h('ul', children);

        if (oldVNode)
            patch(oldVNode, vnode);
        else
            patch(iconContainer, vnode);

        this._oldVNode = vnode;
    }

    selectItem(event: Event, i: IPreviewToolIcon) {
        event.preventDefault();
        event.stopPropagation();
        this._cancelHover();
        const { _block: block } = this;
        if (!block || !this._isCurrentBlock(block))
            return this.hide();
        let cursorBlock = null;
        switch (i.type) {
            case 'view': {
                const preview = this._previewNode();
                const diagram = block as DiagramBlock;
                if (preview) {
                    this.muya.eventCenter.emit('preview-diagram', {
                        type: diagram.meta.type,
                        code: diagram.firstContentInDescendant()?.text ?? '',
                        preview,
                        label: preview.getAttribute('aria-label'),
                    } satisfies IPreviewDiagramPayload);
                }
                break;
            }

            case 'edit': {
                if (block.blockName === 'html-block')
                    this._editHtmlLayout(block as HTMLBlock);
                else
                    cursorBlock = block.firstContentInDescendant();
                break;
            }

            case 'delete': {
                if (block.blockName === 'html-block' && this._deleteHtmlImages(block as HTMLBlock))
                    return this.hide();
                const state = {
                    name: 'paragraph',
                    text: '',
                };

                const newBlock = ScrollPage.loadBlock('paragraph').create(
                    this.muya,
                    state,
                );
                block!.replaceWith(newBlock);
                cursorBlock = newBlock.firstContentInDescendant();
                break;
            }
        }

        if (cursorBlock)
            cursorBlock.setCursor(0, 0);

        this.hide();
    }

    private _deleteHtmlImages(block: HTMLBlock): boolean {
        const content = block.firstContentInDescendant();
        if (!content)
            return false;
        const original = content.text;
        const sources = collectMarkdownImageSources(original);
        if (!sources.length)
            return false;
        const isValid = () => this._isCurrentBlock(block) && block.firstContentInDescendant() === content && content.text === original;
        requestImageDeletion(this.muya, {
            src: sources[0]!,
            sources,
            kind: 'html',
            trigger: 'toolbar',
            isValid,
            commit: () => {
                if (!isValid())
                    return false;
                const viewport = findScrollContainer(this.muya.domNode);
                const { scrollTop, scrollLeft } = viewport;
                const { jsonState, history } = this.muya.editor;
                jsonState.flush();
                history.cutoff();
                const replacement = ScrollPage.loadBlock('paragraph').create(this.muya, { name: 'paragraph', text: '' });
                block.replaceWith(replacement);
                replacement.firstContentInDescendant()?.setCursor(0, 0);
                jsonState.flush();
                history.cutoff();
                viewport.scrollTop = scrollTop;
                viewport.scrollLeft = scrollLeft;
                return true;
            },
        });
        return true;
    }

    private _isCurrentBlock(block: TPreviewBlock): boolean {
        return !this._destroyed
            && !!block.parent
            && !!block.domNode?.isConnected
            && this.muya.editor.scrollPage?.queryBlock(block.path) === block;
    }

    private _viewportAnchor(block: HTMLBlock): () => void {
        const container = findScrollContainer(this.muya.domNode);
        const top = block.domNode!.getBoundingClientRect().top;
        const left = container.scrollLeft;
        return () => {
            if (!this._isCurrentBlock(block))
                return;
            container.scrollTop += block.domNode!.getBoundingClientRect().top - top;
            container.scrollLeft = left;
        };
    }

    private _editHtmlLayout(block: HTMLBlock) {
        const content = block.firstContentInDescendant();
        const preview = this._previewNode();
        if (!content || !preview)
            return;
        let expectedHtml = content.text;
        const restoreViewport = this._viewportAnchor(block);
        const payload: IEditHtmlLayoutPayload = {
            html: expectedHtml,
            preview,
            blockPath: [...block.path],
            isValid: () => this._isCurrentBlock(block) && block.firstContentInDescendant() === content && content.text === expectedHtml,
            apply: (nextHtml) => {
                if (typeof nextHtml !== 'string' || !this._isCurrentBlock(block)
                    || block.firstContentInDescendant() !== content || content.text !== expectedHtml) {
                    return false;
                }
                if (nextHtml === expectedHtml)
                    return true;
                const restorePosition = this._viewportAnchor(block);
                const { jsonState, history } = this.muya.editor;
                jsonState.flush();
                history.cutoff();
                content.text = nextHtml;
                content.update();
                jsonState.flush();
                history.cutoff();
                expectedHtml = nextHtml;
                restorePosition();
                return true;
            },
            restoreViewport,
        };
        this.muya.eventCenter.emit('edit-html-layout', payload);
        restoreViewport();
    }
}
