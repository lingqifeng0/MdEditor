import type Format from '../block/base/format';
import type { Muya } from '../muya';
import type { IImageDeleteRequest } from '../types';
import type { IImageInfo } from './image';
import { findScrollContainer } from './dom';

export function requestImageDeletion(muya: Muya, request: IImageDeleteRequest): void {
    if (muya.options.requestImageDeletion)
        void muya.options.requestImageDeletion(request);
    else if (request.isValid())
        request.commit();
}

export function inlineImageDeletion(muya: Muya, block: Format, info: IImageInfo, trigger: IImageDeleteRequest['trigger']): IImageDeleteRequest {
    const original = block.text;
    const { start, end } = info.token.range;
    const isValid = (): boolean => block.text === original && !!block.domNode?.isConnected
        && muya.editor.scrollPage?.queryBlock(block.path) === block
        && original.slice(start, end) === info.token.raw;
    return {
        src: info.token.src || info.token.attrs.src || '',
        trigger,
        isValid,
        commit: () => {
            if (!isValid())
                return false;
            const viewport = findScrollContainer(muya.domNode);
            const { scrollTop, scrollLeft } = viewport;
            const { jsonState, history } = muya.editor;
            jsonState.flush();
            history.cutoff();
            block.deleteImage(info);
            jsonState.flush();
            history.cutoff();
            viewport.scrollTop = scrollTop;
            viewport.scrollLeft = scrollLeft;
            muya.eventCenter.emit('muya-transformer', { reference: null });
            muya.eventCenter.emit('muya-image-toolbar', { reference: null });
            return true;
        },
    };
}
