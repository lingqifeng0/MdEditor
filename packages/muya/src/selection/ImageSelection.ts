import type Format from '../block/base/format';
import type { Muya } from '../muya';
import type { IHtmlImageTarget } from '../utils/htmlImage';
import type { IImageInfo } from '../utils/image';
import type Selection from './index';
import type { IImageSelectionData } from './types';
import { BLOCK_DOM_PROPERTY, CLASS_NAMES } from '../config';
import { LINK_SELECTOR } from '../editor/linkMouseEvents';
import { isHTMLElement, isKeyboardEvent } from '../utils';
import { createHtmlImageTarget } from '../utils/htmlImage';
import { getImageInfo, getImageSrc } from '../utils/image';
import { inlineImageDeletion, requestImageDeletion } from '../utils/imageDeletion';
import { findContentDOM } from './dom';
import { SelectionType } from './types';

class ImageSelection {
    selected: IImageSelectionData | null = null;
    private _htmlSelected: IHtmlImageTarget | null = null;

    constructor(private _muya: Muya, private _selection: Selection) {}

    attach(): void {
        const { eventCenter, domNode } = this._muya;
        eventCenter.attachDOMEvent(domNode, 'click', this._handleClick);
        eventCenter.attachDOMEvent(domNode, 'contextmenu', this._handleContextMenu);
        eventCenter.attachDOMEvent(document, 'click', this._handleDocClick);
        eventCenter.attachDOMEvent(document, 'keydown', this._handleKeydown, true);
    }

    clear(): void {
        this.selected = null;
        this._htmlSelected = null;
    }

    private _handleDocClick = (event: Event): void => {
        if (event.target === this._htmlSelected?.image)
            return;
        this.clear();
    };

    private _handleClick = (event: Event): void => {
        const { target } = event;
        if (!isHTMLElement(target))
            return;
        const imageWrapper = target.closest<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`);
        this.clear();
        if (imageWrapper)
            this._handleClickInlineImage(event, imageWrapper);
        else if (target instanceof HTMLImageElement)
            this._htmlSelected = createHtmlImageTarget(this._muya, target);
    };

    private _handleContextMenu = (event: Event): void => {
        const { target } = event;
        if (!(target instanceof HTMLImageElement))
            return;
        const wrapper = target.closest<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`);
        if (wrapper) {
            this._handleClickInlineImage(event, wrapper);
            return;
        }
        const htmlImage = createHtmlImageTarget(this._muya, target);
        if (!htmlImage)
            return;
        event.preventDefault();
        event.stopPropagation();
        this.selected = null;
        this._htmlSelected = htmlImage;
        this._muya.eventCenter.emit('muya-transformer', { reference: null });
        this._muya.eventCenter.emit('muya-image-toolbar', {
            reference: target,
            imageInfo: htmlImage.imageInfo,
            htmlImage,
        });
    };

    private _handleKeydown = (event: Event): void => {
        if (!isKeyboardEvent(event))
            return;

        const { key } = event;
        if (event.target instanceof HTMLElement && !this._muya.domNode.contains(event.target) && event.target !== document.body)
            return;
        if (this._htmlSelected && /^(?:Backspace|Delete)$/.test(key)) {
            event.preventDefault();
            event.stopPropagation();
            const target = this._htmlSelected;
            requestImageDeletion(this._muya, { src: target.imageInfo.token.attrs.src || '', trigger: 'keyboard', isValid: target.isValid, commit: target.remove });
            return;
        }
        const { selected } = this;
        if (!selected)
            return;

        if (!selected.block.outMostBlock) {
            this.selected = null;
            return;
        }

        if (key === ' ') {
            event.preventDefault();
            this._previewSelectedImage(selected);
            return;
        }

        if (/^(?:Backspace|Delete)$/.test(key)) {
            event.preventDefault();
            event.stopPropagation();
            const { block, ...imageInfo } = selected;
            if (this._muya.options.requestImageDeletion) {
                requestImageDeletion(this._muya, inlineImageDeletion(this._muya, block, imageInfo, 'keyboard'));
            }
            else {
                block.deleteImage(imageInfo);
                this._selection.activate(SelectionType.TEXT);
            }
        }
        else if (key === 'Enter') {
            event.preventDefault();
            this.clear();
            this._selection.activate(SelectionType.TEXT);
        }
    };

    private _previewSelectedImage(selected: IImageSelectionData) {
        const { token, imageId } = selected;
        const tokenSrc = token.src || token.attrs.src || '';
        const imgSrc
            = this._muya.domNode
                .querySelector<HTMLImageElement>(`#${imageId} img`)
                ?.getAttribute('src') ?? '';
        const src = getImageSrc(tokenSrc).src || imgSrc;

        if (src) {
            this._muya.eventCenter.emit('preview-image', {
                data: src,
            });
        }
    }

    private _imageWrappers(contentDom: HTMLElement): HTMLElement[] {
        return Array.from(
            contentDom.querySelectorAll<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`),
        );
    }

    private _previewModifierClickedImage(event: Event, wrapper: HTMLElement, imageInfo: IImageInfo): void {
        // Linked images delegate modifier-click to link navigation rather than
        // opening a competing image viewer over the destination.
        if (!(event instanceof MouseEvent) || event.type !== 'click'
            || (!event.metaKey && !event.ctrlKey) || wrapper.closest(LINK_SELECTOR)) {
            return;
        }
        const tokenSrc = imageInfo.token.src || imageInfo.token.attrs.src || '';
        const src = getImageSrc(tokenSrc).src || wrapper.querySelector('img')?.getAttribute('src') || '';
        if (src)
            this._muya.eventCenter.emit('format-click', { event, formatType: 'image', data: src });
    }

    private _handleClickInlineImage(event: Event, imageWrapper: HTMLElement) {
        event.preventDefault();
        event.stopPropagation();
        const { eventCenter } = this._muya;
        const imageInfo = getImageInfo(imageWrapper);
        const { target } = event;
        if (!(target instanceof Node))
            return;
        const deleteContainer = isHTMLElement(target)
            ? target.closest('.mu-image-icon-close')
            : null;
        const contentDom = findContentDOM(target);

        if (!contentDom)
            return;

        const contentBlock = contentDom[BLOCK_DOM_PROPERTY] as Format;

        if (deleteContainer) {
            if (this._muya.options.requestImageDeletion)
                requestImageDeletion(this._muya, inlineImageDeletion(this._muya, contentBlock, imageInfo, 'toolbar'));
            else
                contentBlock.deleteImage(imageInfo);

            return;
        }

        if (isHTMLElement(target) && target.tagName === 'IMG') {
            this._previewModifierClickedImage(event, imageWrapper, imageInfo);

            // Identify the clicked image by its position among the paragraph's
            // images, which survives the re-render below — the node does not,
            // and ids are not unique (images sharing a src and paragraph offset
            // render with the same id, so a `#id` lookup finds the first one).
            const imageIndex = this._imageWrappers(contentDom).indexOf(imageWrapper);

            // Selecting the image blurs the paragraph, and `Format.blurHandler`
            // re-renders it whenever the caret sat on a token's markers — which
            // a caret on the image's own line always does. The re-render
            // reassigns the paragraph's `innerHTML`, detaching `imageWrapper`,
            // and the markers it hides can shift the image sideways. So select
            // first and take both references off the live DOM afterwards: from
            // the detached node the resize bar reads a zero rect and draws its
            // handles in the window's corner, and the toolbar a stale one (#5391).
            this._selection.selectImage(Object.assign({}, imageInfo, { block: contentBlock }));

            const liveWrapper = this._imageWrappers(contentDom)[imageIndex] ?? imageWrapper;
            // Blur or an undo replay can replace the wrapper and its cache id.
            // Freeze the connected image selected by this right-click, not an
            // id read from the DOM before selection collapsed the text range.
            Object.assign(imageInfo, {
                imageId: liveWrapper.id,
                image: liveWrapper.querySelector('img') ?? undefined,
            });
            if (this.selected)
                Object.assign(this.selected, imageInfo);
            const imageContainer = liveWrapper.querySelector(
                `.${CLASS_NAMES.MU_IMAGE_CONTAINER}`,
            );
            const rect = imageContainer?.getBoundingClientRect();

            if (event.type === 'contextmenu') {
                eventCenter.emit('muya-image-toolbar', {
                    block: contentBlock,
                    reference: {
                        getBoundingClientRect: () => rect,
                        width: liveWrapper.offsetWidth,
                        height: liveWrapper.offsetHeight,
                    },
                    imageInfo,
                });
            }
            else {
                eventCenter.emit('muya-image-toolbar', { reference: null });
            }

            eventCenter.emit('muya-transformer', {
                block: contentBlock,
                reference: imageContainer,
                imageInfo,
            });

            return;
        }

        if (
            imageWrapper.classList.contains(CLASS_NAMES.MU_EMPTY_IMAGE)
            || imageWrapper.classList.contains(CLASS_NAMES.MU_IMAGE_FAIL)
        ) {
            const rect = imageWrapper.getBoundingClientRect();
            const reference = {
                getBoundingClientRect: () => rect,
                width: imageWrapper.offsetWidth,
                height: imageWrapper.offsetHeight,
            };
            eventCenter.emit('muya-image-selector', {
                block: contentBlock,
                reference,
                imageInfo,
            });
        }
    }
}

export default ImageSelection;
