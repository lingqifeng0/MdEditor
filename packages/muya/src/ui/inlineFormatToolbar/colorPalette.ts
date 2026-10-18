import type { VNode } from 'snabbdom';
import type { TTextColorProperty } from '../../inlineRenderer/portableTextStyle';
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import { normalizeTextColor } from '../../inlineRenderer/portableTextStyle';
import { h } from '../../utils/snabbdom';

const STORAGE_KEY = 'marktext.toolbar.custom-colors.v1';
const CURRENT_COLOR_KEY = 'marktext.toolbar.current-colors.v1';
const DEFAULT_CUSTOM = {
    'color': ['#e0190f', '#00e4ed', '#245bdb', '#8742ff', '#ff84cb'],
    'background-color': ['#ffb78b8c', '#cdf4698c', '#a0ccf68c', '#f0a7d88c', '#adefef8c'],
};

export const THEME_COLORS = [
    '#ffffff',
    '#000000',
    '#eeece1',
    '#1f497d',
    '#4f81bd',
    '#c0504d',
    '#9bbb59',
    '#8064a2',
    '#4bacc6',
    '#f79646',
    '#f2f2f2',
    '#808080',
    '#ddd9c3',
    '#c6d9f1',
    '#dbe5f1',
    '#f2dcdb',
    '#ebf1dd',
    '#e5e0ec',
    '#dbeef3',
    '#fdeada',
    '#d9d9d9',
    '#595959',
    '#c4bd97',
    '#8db3e2',
    '#b8cce4',
    '#e5b9b7',
    '#d7e3bc',
    '#ccc1d9',
    '#b7dde8',
    '#fbd5b5',
    '#bfbfbf',
    '#404040',
    '#948a54',
    '#548dd4',
    '#95b3d7',
    '#d99694',
    '#c3d69b',
    '#b2a2c7',
    '#92cddc',
    '#fac090',
    '#a6a6a6',
    '#262626',
    '#494429',
    '#17365d',
    '#366092',
    '#953735',
    '#76923c',
    '#5f497a',
    '#31859b',
    '#e36c09',
    '#808080',
    '#0d0d0d',
    '#1d1b10',
    '#0f243e',
    '#244061',
    '#632523',
    '#4f6128',
    '#403151',
    '#205867',
    '#984807',
];
export const STANDARD_COLORS = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];
export const TRANSLUCENT_COLORS = ['#8c8c8c1f', '#5c5c5c33', '#a3431f33', '#f06b0533', '#f0c80033', '#03876633', '#27856333', '#1d729b33', '#664dcc33', '#8831cc33'];
export const HIGHLIGHTER_COLORS = ['#fff88f', '#d3f8b6', '#affad1', '#b1ffff', '#fdbfff', '#d2cbff', '#40a9ff', '#ff4d4f', '#d4b106', '#9254de'];

export function withOpacity(hex: string, opacity: number): string {
    const color = normalizeTextColor(hex) ?? '#000000';
    const alpha = Math.round(Math.max(0, Math.min(100, opacity)) * 255 / 100);
    return color.slice(0, 7) + (alpha === 255 ? '' : alpha.toString(16).padStart(2, '0'));
}

export function readCurrentColors(): Record<TTextColorProperty, string> {
    const colors = { 'color': '#e0190f', 'background-color': '#fff3a3' };
    try {
        const saved = JSON.parse(localStorage.getItem(CURRENT_COLOR_KEY) ?? 'null');
        for (const property of ['color', 'background-color'] as const)
            colors[property] = typeof saved?.[property] === 'string' ? normalizeTextColor(saved[property]) ?? colors[property] : colors[property];
    }
    catch {}
    return colors;
}

export function saveCurrentColors(colors: Record<TTextColorProperty, string>): void {
    try {
        localStorage.setItem(CURRENT_COLOR_KEY, JSON.stringify(colors));
    }
    catch {}
}

function readCustomColors(): Record<TTextColorProperty, string[]> {
    const defaults = { 'color': [...DEFAULT_CUSTOM.color], 'background-color': [...DEFAULT_CUSTOM['background-color']] };
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        for (const property of ['color', 'background-color'] as const) {
            if (Array.isArray(saved?.[property])) {
                const slots: unknown[] = saved[property];
                defaults[property] = Array.from({ length: Math.max(5, Math.min(20, slots.length)) }, (_, index) => {
                    const color = slots[index];
                    return (typeof color === 'string' ? normalizeTextColor(color) : null) ?? DEFAULT_CUSTOM[property][index % 5];
                });
            }
        }
    }
    catch {}
    return defaults;
}

/** A color menu keeps draft edits separate from the frozen document selection. */
export class ToolbarColorPalette {
    private _custom = readCustomColors();
    private _property: TTextColorProperty | null = null;
    private _draft = '#e0190f';
    private _editingSlot: number | null = null;
    private _generation = 0;
    private _validation = '';
    private _cleanup: (() => void) | null = null;
    private _button: HTMLElement | null = null;
    private _menu: HTMLElement | null = null;

    constructor(private _apply: (property: TTextColorProperty, color: string | null) => void, private _refresh: () => void, private _close: () => void) {}

    open(property: TTextColorProperty, color: string): void {
        this.hide();
        this._property = property;
        this._draft = normalizeTextColor(color) ?? '#e0190f';
        this._editingSlot = null;
        this._validation = '';
    }

    position(button: HTMLElement | null, menu: HTMLElement | null): void {
        if (!button || !menu || (this._button === button && this._menu === menu))
            return;
        this._cleanup?.();
        this._button = button;
        this._menu = menu;
        this._cleanup = autoUpdate(button, menu, () => {
            void computePosition(button, menu, { strategy: 'fixed', placement: 'bottom-end', middleware: [offset(8), flip(), shift({ padding: 12, crossAxis: true })] })
                .then(({ x, y }) => {
                    if (this._menu === menu && this._property)
                        Object.assign(menu.style, { left: `${x}px`, top: `${y}px` });
                });
        });
    }

    hide(): void {
        this._generation++;
        this._cleanup?.();
        this._cleanup = null;
        this._button = null;
        this._menu = null;
        this._property = null;
        this._editingSlot = null;
    }

    private _isCurrent(property: TTextColorProperty, generation: number): boolean {
        return this._property === property && this._generation === generation;
    }

    private _buttonNode(label: string, title: string, action: () => void, className = ''): VNode {
        return h(`button.mu-palette-action${className ? `.${className}` : ''}`, {
            attrs: { 'type': 'button', title, 'aria-label': title },
            on: {
                mousedown: event => event.preventDefault(),
                click: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    action();
                },
            },
        }, label);
    }

    private _group(property: TTextColorProperty, generation: number, title: string, colors: string[], round = false, custom = false): VNode {
        return h('div.mu-palette-group', [h('div.mu-color-label', title), h(`div.mu-palette-grid${round ? '.round' : ''}`, colors.map((color, index) => h('button.mu-color-swatch', {
            key: `${index}-${color}`,
            attrs: { 'type': 'button', 'title': custom ? `${color} · 右键设置此槽位` : color, 'aria-label': `${title} ${color}`, 'data-color': color, ...(custom ? { 'data-slot': String(index) } : {}) },
            style: { 'background-color': color },
            on: {
                mousedown: event => event.preventDefault(),
                click: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (this._isCurrent(property, generation))
                        this._apply(property, color);
                },
                ...(custom
                    ? { contextmenu: (event: Event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (!this._isCurrent(property, generation))
                                return;
                            this._editingSlot = index;
                            this._draft = color;
                            this._validation = '';
                            this._refresh();
                        } }
                    : {}),
            },
        })))]);
    }

    private _saveDraft(property: TTextColorProperty, slot: number, generation: number): void {
        // Native pickers can complete after a palette was closed or replaced.
        // A callback belongs to its original property, slot and open session.
        if (!this._isCurrent(property, generation) || this._editingSlot !== slot)
            return;
        // A toolbar click preserves input focus, so `change` may not have fired.
        const value = this._menu?.querySelector<HTMLInputElement>('.mu-color-hex')?.value ?? this._draft;
        const color = normalizeTextColor(value.trim());
        if (!color) {
            this._validation = '请输入有效的 HEX 颜色';
            this._refresh();
            return;
        }
        const slots = Array.isArray(this._custom[property]) ? [...this._custom[property]] : [...DEFAULT_CUSTOM[property]];
        if (slot < 0 || slot >= slots.length)
            return;
        slots[slot] = color;
        this._custom[property] = slots;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._custom));
        }
        catch {}
        this._editingSlot = null;
        this._refresh();
    }

    private _customEditor(property: TTextColorProperty, slot: number, generation: number): VNode {
        const color = normalizeTextColor(this._draft) ?? '#000000';
        const opacity = color.length === 9 ? Number.parseInt(color.slice(7), 16) * 100 / 255 : 100;
        const current = () => this._isCurrent(property, generation) && this._editingSlot === slot;
        return h('div.mu-custom-color-editor', [
            h('div.mu-color-label', `设置自定义颜色 ${slot + 1}`),
            h('div.mu-custom-color-row', [
                h('label', ['自选颜色', h('input.mu-color-input', {
                    attrs: { 'type': 'color', 'aria-label': '自选颜色' },
                    props: { value: color.slice(0, 7) },
                    on: { change: (event) => {
                        if (!current())
                            return;
                        this._draft = (event.target as HTMLInputElement).value + color.slice(7);
                        this._validation = '';
                        this._refresh();
                    } },
                })]),
                h('input.mu-color-hex', {
                    attrs: { 'type': 'text', 'aria-label': '颜色 HEX，可含透明度', 'spellcheck': 'false', 'maxlength': '9' },
                    props: { value: this._draft },
                    on: { input: (event) => {
                        if (!current())
                            return;
                        this._draft = (event.target as HTMLInputElement).value;
                        const parsed = normalizeTextColor(this._draft.trim());
                        this._validation = parsed ? '' : '请输入 #RGB、#RRGGBB 或含透明度的 HEX 颜色';
                        this._refresh();
                    } },
                }),
            ]),
            h('label.mu-opacity-control', [
                `不透明度 ${Math.round(opacity)}%`,
                h('input', { attrs: { 'type': 'range', 'min': '0', 'max': '100', 'step': '1', 'aria-label': '颜色不透明度' }, props: { value: opacity }, on: { input: (event) => {
                    if (!current())
                        return;
                    this._draft = withOpacity(color, Number((event.target as HTMLInputElement).value));
                    this._refresh();
                } } }),
            ]),
            h('div.mu-color-preview', [h('span', { style: { 'background-color': color } }, '颜色预览')]),
            ...(this._validation ? [h('div.mu-color-validation', { attrs: { role: 'alert' } }, this._validation)] : []),
            h('div.mu-palette-footer', [
                this._buttonNode('保存槽位', '保存此自定义颜色槽位', () => this._saveDraft(property, slot, generation), 'save-custom'),
                this._buttonNode('取消', '取消设置自定义颜色', () => {
                    if (current()) {
                        this._editingSlot = null;
                        this._refresh();
                    }
                }, 'cancel-custom'),
            ]),
        ]);
    }

    render(): VNode {
        const property = this._property;
        if (!property)
            return h('div.mu-color-palette', { attrs: { hidden: true } });
        const generation = this._generation;
        const background = property === 'background-color';
        const groups = background
            ? [this._group(property, generation, '半透明颜色', TRANSLUCENT_COLORS, true), this._group(property, generation, '高亮颜色', HIGHLIGHTER_COLORS, true)]
            : [this._group(property, generation, '主题颜色', THEME_COLORS), this._group(property, generation, '标准颜色', STANDARD_COLORS)];
        groups.push(this._group(property, generation, '自定义颜色', this._custom[property], background, true));
        groups.push(h('div.mu-color-hint', '左键应用 · 右键设置自定义槽位'));
        return h(`div.mu-color-palette${background ? '.background' : ''}`, {
            attrs: { 'role': 'dialog', 'aria-label': background ? '背景颜色' : '字体颜色' },
            on: {
                click: event => event.stopPropagation(),
                keydown: (event) => {
                    if ((event as KeyboardEvent).key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        this._close();
                    }
                },
            },
        }, [...groups, ...(this._editingSlot !== null ? [this._customEditor(property, this._editingSlot, generation)] : [])]);
    }
}
