import { h } from '../../utils/snabbdom';
import glyphPaths from './glyphPaths.json';

const paths: Record<string, string[]> = glyphPaths;

export function toolbarGlyph(name: string) {
    return h('svg.mu-toolbar-glyph', {
        attrs: { 'viewBox': '0 0 24 24', 'fill': 'none', 'stroke': 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    }, (paths[name] ?? []).map((d, index) => h('path', { attrs: { d, ...(name === 'mark' && index === 2 ? { stroke: '#fff18c' } : {}) } })));
}
