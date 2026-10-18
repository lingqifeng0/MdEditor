import type { ReferenceElement } from '@floating-ui/dom';
import type { VNode } from 'snabbdom';
import type Format from '../../block/base/format';
import type { Muya } from '../../index';

import type { ImageToken } from '../../inlineRenderer/types';
import type { IHtmlImageTarget } from '../../utils/htmlImage';
import type { IImageInfo } from '../../utils/image';
import type { Icon, TImageToolbarAction } from './config';
import { isKeyboardEvent } from '../../utils';
import { inlineImageDeletion, requestImageDeletion } from '../../utils/imageDeletion';
import { h, patch } from '../../utils/snabbdom';
import BaseFloat from '../baseFloat';
import icons from './config';
import './index.css';

const defaultOptions = {
    placement: 'top' as const,
    offsetOptions: {
        mainAxis: 10,
        crossAxis: 0,
        alignmentAxis: 0,
    },
    showArrow: false,
};

export class ImageToolBar extends BaseFloat {
    static pluginName = 'imageToolbar';
    private _oldVNode: VNode | null = null;
    private _imageInfo: {
        token: ImageToken;
        imageId: string;
        image?: HTMLImageElement;
    } | null = null;

    private _icons: Icon[] = icons;
    private _reference: ReferenceElement | null = null;
    private _block: Format | null = null;
    private _htmlImage: IHtmlImageTarget | null = null;
    private _toolbarContainer: HTMLDivElement = document.createElement('div');
    private _showFrame: number | null = null;
    private _destroyed = false;

    constructor(muya: Muya, options = {}) {
        const name = 'mu-image-toolbar';
        const opts = Object.assign({}, defaultOptions, options);

        super(muya, name, opts);

        this.container!.appendChild(this._toolbarContainer);
        this.floatBox!.classList.add('mu-image-toolbar-container');

        this.listen();
    }

    override listen() {
        const { eventCenter } = this.muya;
        super.listen();
        eventCenter.on('muya-image-toolbar', ({ block, reference, imageInfo, htmlImage }) => {
            if (this._destroyed)
                return;
            this._cancelShow();
            this._reference = reference ?? null;
            if (reference && (block || htmlImage) && imageInfo?.token) {
                this._block = block ?? null;
                this._htmlImage = htmlImage ?? null;
                this._imageInfo = imageInfo;
                this._render();
                this._showFrame = requestAnimationFrame(() => {
                    this._showFrame = null;
                    if (this._reference !== reference || !this.floatBox?.isConnected)
                        return;
                    this.show(reference);
                });
            }
            else {
                this.hide();
            }
        });
    }

    private _render() {
        const { _icons: icons, _oldVNode: oldVNode, _toolbarContainer: toolbarContainer, _imageInfo: imageInfo } = this;
        const { i18n } = this.muya;
        if (!imageInfo)
            return;
        const { attrs } = imageInfo.token;
        const dataAlign = attrs['data-align'];
        const visibleIcons = this._htmlImage ? icons.filter(icon => ['open', 'copy', 'reveal', 'edit', 'delete'].includes(icon.type)) : icons;
        this.container!.classList.toggle('mu-html-image-toolbar', !!this._htmlImage);
        const children = visibleIcons.map((i) => {
            const disabled = this._isDisabled(i.type);
            const tooltip = disabled
                ? this._source().trim() ? i.type === 'open' ? 'Open local images only' : 'Local images only' : 'Image source is empty'
                : i.tooltip;
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
            let itemSelector = `li.item.${i.type}`;

            if (i.type === dataAlign || (!dataAlign && i.type === 'inline'))
                itemSelector += '.active';

            return h(
                itemSelector,
                {
                    dataset: {
                        tip: i.tooltip,
                    },
                    attrs: {
                        'title': i18n.t(tooltip),
                        'role': 'button',
                        'tabindex': disabled ? '-1' : '0',
                        'aria-label': i.ariaLabel ?? i18n.t(i.tooltip),
                        'aria-disabled': String(disabled),
                    },
                    on: {
                        mousedown: (event) => {
                            // Keep the frozen image selection and editor caret
                            // when activating a toolbar outside the editor.
                            event.preventDefault();
                            event.stopPropagation();
                        },
                        click: (event) => {
                            this._selectItem(event, i);
                        },
                        keydown: (event) => {
                            if (isKeyboardEvent(event) && (event.key === 'Enter' || event.key === ' '))
                                this._selectItem(event, i);
                        },
                    },
                },
                iconWrapper,
            );
        });

        const vnode = h('ul', children);

        if (oldVNode)
            patch(oldVNode, vnode);
        else
            patch(toolbarContainer, vnode);

        this._oldVNode = vnode;
    }

    private _selectItem(event: Event, item: Icon) {
        event.preventDefault();
        event.stopPropagation();

        const { _imageInfo: imageInfo } = this;
        if (!imageInfo || !this._hasImageTarget() || this._isDisabled(item.type))
            return;

        switch (item.type) {
            case 'copy':
            case 'reveal':
            case 'open':
            {
                const image = this._htmlImage?.image ?? imageInfo.image;
                const payload = {
                    src: this._source(),
                    imageId: imageInfo.imageId,
                    ...(image ? { image } : {}),
                };
                // Freeze the action before closing: a file watcher can replace
                // the image DOM while an external editor owns focus.
                this.hide();
                this.muya.eventCenter.emit(item.type === 'copy' ? 'copy-image' : item.type === 'reveal' ? 'reveal-image' : 'open-image-in-editor', payload);
                return;
            }

            // Delete image.
            case 'delete':
                return this._deleteImage(imageInfo);

                // Edit image, for example: editor alt and title, replace image.
            case 'edit': {
                const rect = this._reference!.getBoundingClientRect();
                const reference = {
                    getBoundingClientRect() {
                        rect.height = 0;

                        return rect;
                    },
                };
                // Hide image resize bar
                this.muya.eventCenter.emit('muya-transformer', {
                    reference: null,
                });

                this.muya.eventCenter.emit('muya-image-selector', {
                    block: this._block,
                    reference,
                    imageInfo,
                    ...(this._htmlImage ? { replace: this._htmlImage.replace } : {}),
                });

                return this.hide();
            }

            case 'inline':
                // fall through
            case 'left':
                // fall through
            case 'center':
                // fall through
            case 'right': {
                this._block?.updateImage(this._imageInfo!, 'data-align', item.type);

                return this.hide();
            }
        }
    }

    private _source(): string {
        const token = this._imageInfo?.token;
        return token?.src || token?.attrs.src || '';
    }

    private _hasImageTarget(): boolean {
        return !!(this._block || this._htmlImage);
    }

    private _deleteImage(imageInfo: IImageInfo): void {
        if (this.muya.options.requestImageDeletion) {
            const html = this._htmlImage;
            const request = html
                ? { src: this._source(), trigger: 'toolbar' as const, isValid: html.isValid, commit: html.remove }
                : inlineImageDeletion(this.muya, this._block!, imageInfo, 'toolbar');
            this.hide();
            requestImageDeletion(this.muya, request);
            return;
        }
        if (this._htmlImage)
            this._htmlImage.remove();
        else
            this._block!.deleteImage(imageInfo);
        this.muya.eventCenter.emit('muya-transformer', { reference: null });
        this.hide();
    }

    private _isDisabled(action: TImageToolbarAction): boolean {
        if (action !== 'copy' && action !== 'reveal' && action !== 'open')
            return false;
        const source = this._source().trim();
        if (!source)
            return true;
        if (action === 'copy')
            return false;
        if (/^(?:file:\/\/|[a-z]:[\\/])/i.test(source))
            return false;
        return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source);
    }

    private _cancelShow(): void {
        if (this._showFrame !== null) {
            cancelAnimationFrame(this._showFrame);
            this._showFrame = null;
        }
    }

    override hide(): void {
        this._cancelShow();
        this._reference = null;
        this._imageInfo = null;
        this._block = null;
        this._htmlImage = null;
        super.hide();
    }

    override destroy(): void {
        this._destroyed = true;
        this.hide();
        super.destroy();
    }
}
