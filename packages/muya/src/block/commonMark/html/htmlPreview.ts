import type { Muya } from '../../../muya';
import type { IHtmlBlockState, TState } from '../../../state/types';
import { CLASS_NAMES, PREVIEW_DOMPURIFY_CONFIG } from '../../../config';
import { sanitize } from '../../../utils';
import { getImageSrc } from '../../../utils/image';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';

const debug = logger('htmlPreview:');

// Elements whose rendered content comes from attributes (e.g. `src`) rather
// than child nodes, so an empty tag body must not be treated as an empty block.
const SELF_CONTAINED_MEDIA = new Set(['video', 'audio']);

// A single element with an empty body (`<div></div>`), except self-contained
// media elements whose content lives in attributes (`<video src=...></video>`).
export function isEmptyHtmlBlock(html: string): boolean {
    // eslint-disable-next-line regexp/no-super-linear-backtracking, regexp/optimal-quantifier-concatenation
    const match = html.trim().match(/^<([a-z][a-z\d]*)[^>]*>\s*<\/\1>$/);
    return !!match && !SELF_CONTAINED_MEDIA.has(match[1]);
}

class HTMLPreview extends Parent {
    private _html: string;
    private _imageReloadVersion = 0;
    private _imageReloadToken = '';

    static override blockName = 'html-preview';

    static create(muya: Muya, state: IHtmlBlockState) {
        const htmlBlock = new HTMLPreview(muya, state);

        return htmlBlock;
    }

    override get path() {
        debug.warn('You can never call `get path` in htmlPreview');
        return [];
    }

    constructor(muya: Muya, { text }: IHtmlBlockState) {
        super(muya);
        this.tagName = 'div';
        this._html = text;
        this.classList = [CLASS_NAMES.MU_HTML_PREVIEW];
        this.attributes = {
            spellcheck: 'false',
            contenteditable: 'false',
        };
        this.createDomNode();
        this.update();
    }

    update(html = this._html) {
        if (this._html !== html)
            this._html = html;

        const { disableHtml, transformHtmlPreview } = this.muya.options;
        const renderedHtml = !disableHtml && transformHtmlPreview ? transformHtmlPreview(html) : html;
        const htmlContent = sanitize(renderedHtml, PREVIEW_DOMPURIFY_CONFIG, disableHtml) as string;

        // handle empty html bock
        if (isEmptyHtmlBlock(htmlContent)) {
            this.domNode!.innerHTML
                = `<div class="${CLASS_NAMES.MU_EMPTY}">&lt;Empty HTML Block&gt;</div>`;
        }
        else {
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');
            const imgs = doc.documentElement.querySelectorAll('img');

            for (const img of imgs) {
                const src = img.getAttribute('src')!;
                const imageSrc = getImageSrc(src);
                let renderedSrc = imageSrc.src;
                if (this._imageReloadToken && /^file:/i.test(renderedSrc)) {
                    try {
                        const url = new URL(renderedSrc);
                        url.searchParams.set('mucache', this._imageReloadToken);
                        renderedSrc = url.href;
                    }
                    catch {}
                }
                img.setAttribute('src', renderedSrc);
            }

            this.domNode!.innerHTML
                = doc.documentElement!.querySelector('body')!.innerHTML;
        }
    }

    /** Reload local image files without changing their source attributes in document state. */
    reloadImages() {
        this._imageReloadToken = `${Date.now()}-${++this._imageReloadVersion}`;
        this.update();
    }

    override getState(): TState {
        debug.warn('You can never call `getState` in htmlPreview');
        return {} as TState;
    }
}

export default HTMLPreview;
