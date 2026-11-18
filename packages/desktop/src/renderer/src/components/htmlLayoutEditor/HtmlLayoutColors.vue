<template>
  <section class="layout-colors" aria-label="颜色和样式">
    <div class="layout-color-tabs" role="group" aria-label="格式设置">
      <template v-if="table">
        <button type="button" :aria-pressed="group === 'table'" @click="emit('group', 'table')">表格样式</button>
        <button type="button" :aria-pressed="group === 'font'" @click="emit('group', 'font')">字体</button>
      </template>
      <strong v-else>字体</strong>
    </div>
    <div class="layout-color-heading">
      <div v-if="appearance" class="layout-color-modes" role="group" aria-label="表格颜色">
        <button type="button" :aria-pressed="target === 'fill'" @click="emit('target', 'fill')">底色</button>
        <button type="button" :aria-pressed="target === 'grid'" @click="emit('target', 'grid')">线条色</button>
      </div>
      <span v-else>文字颜色</span>
      <button type="button" @click="emit('paint', null)">清除颜色</button>
    </div>
    <div class="layout-color-swatches">
      <div role="group" aria-label="常用色">
        <button
          v-for="(color, index) in palette"
          :key="index"
          type="button"
          :style="{ '--swatch': color }"
          :aria-label="`常用色 ${index + 1} ${color}`"
          @click="emit('paint', color)"
        />
      </div>
      <input
        :data-testid="appearance ? `html-layout-${target}-color` : 'html-layout-text-color'"
        type="color"
        :value="appearance ? colors[target] : colors.text"
        :aria-label="appearance ? (target === 'fill' ? '自选底色' : '自选线条色') : '文字颜色'"
        @input="emit('paint', ($event.target as HTMLInputElement).value, true)"
      >
    </div>
    <details class="layout-color-slots">
      <summary>编辑常用色槽</summary>
      <div class="layout-color-slot-fields">
        <label>色槽
          <select v-model.number="slot">
            <option v-for="(_, index) in palette" :key="index" :value="index">色槽 {{ index + 1 }}</option>
          </select>
        </label>
        <label>色值
          <input v-model.trim="slotColor" type="text" maxlength="7" placeholder="#RRGGBB">
        </label>
        <input type="color" :value="validColor(slotColor) ? slotColor : palette[slot]" aria-label="选择色槽颜色" @input="slotColor = ($event.target as HTMLInputElement).value">
      </div>
      <button type="button" :disabled="!validColor(slotColor)" @click="saveSlot">保存色槽</button>
      <output aria-live="polite">{{ slotStatus }}</output>
    </details>
    <label v-if="table" class="html-layout-field layout-color-scope">
      应用范围
      <select
        v-if="cell && (!appearance || target !== 'grid')"
        data-testid="html-layout-color-scope"
        :value="scope"
        @change="emit('scope', ($event.target as HTMLSelectElement).value as Scope)"
      >
        <option value="cell">当前单元格</option>
        <option value="row">当前行</option>
        <option value="head">表头</option>
        <option value="table">整张表</option>
      </select>
      <output v-else>整张表</output>
    </label>
    <div v-if="!appearance" class="html-layout-size-fields">
      <label class="html-layout-field">字体
        <select :value="fontFamily" @change="emit('fontFamily', ($event.target as HTMLSelectElement).value)">
          <option v-for="(family, index) in HTML_LAYOUT_FONT_FAMILIES" :key="family" :value="family">{{ familyNames[index] }}</option>
        </select>
      </label>
      <label class="html-layout-field">字号（px）
        <input
          data-testid="html-layout-font-size"
          type="number"
          :value="fontSize"
          min="8"
          max="200"
          @input="emit('fontSize', $event)"
          @change="emit('fontSize', $event)"
        >
      </label>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { HTML_LAYOUT_FONT_FAMILIES } from '@/util/htmlLayoutTableStyles'

type Scope = 'cell' | 'row' | 'head' | 'table'
const props = defineProps<{
  table: boolean
  cell: boolean
  group: 'table' | 'font'
  target: 'fill' | 'grid'
  scope: Scope
  colors: { text: string; fill: string; grid: string }
  fontFamily: string
  fontSize: number
}>()
const emit = defineEmits<{
  (event: 'group', value: 'table' | 'font'): void
  (event: 'target', value: 'fill' | 'grid'): void
  (event: 'scope', value: Scope): void
  (event: 'paint', value: string | null, typing?: boolean): void
  (event: 'fontFamily', value: string): void
  (event: 'fontSize', value: Event): void
}>()

const appearance = computed(() => props.table && props.group === 'table')
const familyNames = ['跟随正文', '微软雅黑', '衬线', '等宽']
const paletteKey = 'mdeditor.htmlLayout.colors'
const defaults = ['#467db3', '#3b815f', '#9e713a', '#ac5d76', '#8a6eb1', '#ded09c']
const validColor = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)

function readPalette (): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(paletteKey) ?? 'null')
    if (Array.isArray(saved) && saved.length === defaults.length && saved.every(validColor)) return saved
  } catch { /* Unavailable preferences should not block layout editing. */ }
  return [...defaults]
}

const palette = ref(readPalette())
const slot = ref(0)
const slotColor = ref(palette.value[0]!)
const slotStatus = ref('')
watch(slot, (index) => {
  slotColor.value = palette.value[index]!
  slotStatus.value = ''
})

function saveSlot () {
  if (!validColor(slotColor.value)) return
  palette.value[slot.value] = slotColor.value.toLowerCase()
  try {
    localStorage.setItem(paletteKey, JSON.stringify(palette.value))
    slotStatus.value = '已保存'
  } catch {
    slotStatus.value = '已更新当前色槽'
  }
}
</script>

<style scoped>
.layout-colors { display: grid; gap: 9px; margin-bottom: 14px; font-size: 13px; }
.layout-color-tabs, .layout-color-modes, .layout-color-swatches > div { display: flex; gap: 5px; align-items: center; }
.layout-color-tabs { min-height: 36px; padding-bottom: 7px; border-bottom: 1px solid var(--editorColor10); }
.layout-color-heading, .layout-color-swatches { display: flex; align-items: center; justify-content: space-between; gap: 5px; }
.layout-color-heading { min-height: 28px; }
.layout-colors button { padding: 4px 7px; min-height: 28px; font-size: 12px; }
.layout-colors button[aria-pressed="true"] { color: var(--themeColor); border-color: var(--themeColor); }
.layout-color-swatches button {
  width: 21px; height: 21px; min-height: 0; padding: 0; background: var(--swatch);
}
.layout-colors input[type="color"] { width: 29px; height: 27px; padding: 2px; cursor: pointer; }
.layout-color-slots summary { cursor: pointer; color: var(--editorColor60); }
.layout-color-slot-fields { display: grid; grid-template-columns: 1fr 1.2fr 29px; gap: 5px; align-items: end; margin: 6px 0; }
.layout-color-slot-fields label { display: grid; gap: 4px; min-width: 0; }
.layout-color-slot-fields :is(select, input) { width: 100%; min-width: 0; padding: 4px; }
.layout-color-slots output { margin-left: 5px; color: var(--editorColor60); }
.layout-colors .html-layout-field { margin-bottom: 0; }
.layout-color-scope output {
  padding: 7px; min-height: 34px; border: 1px solid var(--editorColor10); border-radius: 5px; color: var(--editorColor60);
}
</style>
