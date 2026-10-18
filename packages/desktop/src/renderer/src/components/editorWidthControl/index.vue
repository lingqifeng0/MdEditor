<template>
  <section
    class="editor-width-control"
    :class="{ compact }"
    :aria-label="t('preferences.editor.textEditor.contentWidth')"
    @keydown.stop
  >
    <slot v-if="compact" name="leading" />
    <label
      class="width-label"
      :for="`${controlId}-slider`"
    >{{ t('preferences.editor.textEditor.contentWidth') }}</label>
    <input
      :id="`${controlId}-slider`"
      class="width-slider"
      data-testid="editor-width-slider"
      type="range"
      :value="draft.amount"
      :min="sliderLimits.min"
      :max="sliderLimits.max"
      :step="sliderLimits.step"
      :aria-label="t('preferences.editor.textEditor.contentWidth')"
      @input="previewSlider"
      @change="commitSlider"
      @keydown.esc.prevent="cancelPreview"
    >
    <input
      class="width-value"
      data-testid="editor-width-value"
      type="number"
      min="0"
      step="1"
      :value="valueText"
      :aria-label="t('preferences.editor.textEditor.contentWidth')"
      @input="previewNumber"
      @change="commitNumber"
      @blur="restoreInvalidInput"
      @keydown.enter.prevent="commitNumber"
      @keydown.esc.prevent="cancelPreview"
    >
    <select
      class="width-unit"
      data-testid="editor-width-unit"
      :value="draft.unit"
      :aria-label="t('preferences.editor.textEditor.contentWidthUnit')"
      @change="changeUnit"
    >
      <option value="px">
        px
      </option>
      <option value="%">
        %
      </option>
      <option value="ch">
        ch
      </option>
    </select>
    <button
      class="width-reset"
      data-testid="editor-width-reset"
      type="button"
      :title="t('preferences.editor.textEditor.contentWidthDefaultNotes')"
      @click="resetWidth"
    >
      {{ t('preferences.editor.textEditor.contentWidthReset') }}
    </button>
    <p
      v-if="!compact"
      class="width-notes"
    >
      {{ t('preferences.editor.textEditor.contentWidthDefaultNotes') }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/store/preferences'
import { setEditorWidth } from '@/util/theme'
import {
  DEFAULT_EDITOR_CONTENT_WIDTH,
  defaultEditorWidthForUnit,
  editorWidthSliderLimits,
  formatEditorWidth,
  parseEditorWidth,
  type EditorWidthUnit,
  type EditorWidthValue
} from '@/util/editorWidth'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const { t } = useI18n()
const controlId = useId()
const preferencesStore = usePreferencesStore()
const { editorLineWidth } = storeToRefs(preferencesStore)
const defaultWidth = (): EditorWidthValue => ({ amount: DEFAULT_EDITOR_CONTENT_WIDTH, unit: 'px' })
const draft = ref(parseEditorWidth(editorLineWidth.value) ?? defaultWidth())
const valueText = ref(String(draft.value.amount))
const isPreviewing = ref(false)
const sliderLimits = computed(() => editorWidthSliderLimits(draft.value))

const syncDraft = (): void => {
  draft.value = parseEditorWidth(editorLineWidth.value) ?? defaultWidth()
  valueText.value = String(draft.value.amount)
  isPreviewing.value = false
}

watch(editorLineWidth, syncDraft)

const preview = (amount: number): void => {
  const value = formatEditorWidth(amount, draft.value.unit)
  if (value === null) return
  draft.value = { ...draft.value, amount }
  isPreviewing.value = true
  // The preview stays in this window; only the final change goes through
  // electron-store, whose writes are synchronous in the main process.
  setEditorWidth(value)
}

const commit = (value: string): void => {
  isPreviewing.value = false
  setEditorWidth(value)
  if (value !== editorLineWidth.value) {
    preferencesStore.SET_SINGLE_PREFERENCE({ type: 'editorLineWidth', value })
  }
  syncDraft()
}

const inputValue = (event: Event): string => (event.target as HTMLInputElement).value

const previewSlider = (event: Event): void => {
  valueText.value = inputValue(event)
  preview(Number(valueText.value))
}

const commitSlider = (event: Event): void => {
  const value = formatEditorWidth(Number(inputValue(event)), draft.value.unit)
  if (value !== null) commit(value)
}

const previewNumber = (event: Event): void => {
  valueText.value = inputValue(event)
  if (/^[0-9]+$/.test(valueText.value)) preview(Number(valueText.value))
}

const commitNumber = (): void => {
  if (!/^[0-9]+$/.test(valueText.value)) {
    cancelPreview()
    return
  }
  const value = formatEditorWidth(Number(valueText.value), draft.value.unit)
  if (value === null) cancelPreview()
  else commit(value)
}

const changeUnit = (event: Event): void => {
  const unit = (event.target as HTMLSelectElement).value as EditorWidthUnit
  const amount = defaultEditorWidthForUnit(unit)
  const value = formatEditorWidth(amount, unit)
  if (value !== null) commit(value)
}

const cancelPreview = (): void => {
  setEditorWidth(editorLineWidth.value)
  syncDraft()
}

const restoreInvalidInput = (): void => {
  if (!/^[0-9]+$/.test(valueText.value) || !Number.isSafeInteger(Number(valueText.value))) {
    cancelPreview()
  }
}

const resetWidth = (): void => commit('')

onBeforeUnmount(() => {
  if (isPreviewing.value) setEditorWidth(editorLineWidth.value)
})
</script>

<style scoped>
.editor-width-control {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
  color: var(--editorColor);
  font-size: 14px;
}
.width-label { flex-basis: 100%; }
.width-slider { flex: 1; min-width: 80px; margin: 0; accent-color: var(--themeColor); }
.width-value,
.width-unit,
.width-reset {
  height: 26px;
  box-sizing: border-box;
  border: 1px solid var(--editorColor10);
  border-radius: 4px;
  background: var(--editorBgColor);
  color: var(--editorColor);
  font: inherit;
}
.width-value { width: 76px; padding: 1px 5px; }
.width-unit { width: 46px; padding: 1px 3px; }
.width-reset { padding: 1px 8px; cursor: pointer; }
.width-reset:hover { color: var(--themeColor); border-color: var(--themeColor); }
.width-value:focus-visible,
.width-unit:focus-visible,
.width-reset:focus-visible,
.width-slider:focus-visible { outline: 2px solid var(--themeColor); outline-offset: 1px; }
.width-notes { flex-basis: 100%; margin: 0; font-size: 12px; color: var(--editorColor60); }
.editor-width-control.compact {
  flex: 0 0 30px;
  justify-content: flex-end;
  flex-wrap: nowrap;
  gap: 6px;
  min-width: 0;
  height: 30px;
  box-sizing: border-box;
  margin: 0;
  padding: 0 10px;
  border-top: 1px solid var(--editorColor10);
  background: var(--editorBgColor);
  font-size: 12px;
}
.compact .width-label { flex-basis: auto; white-space: nowrap; }
.compact .width-slider { flex: 0 1 150px; }
.compact .width-value,
.compact .width-unit,
.compact .width-reset { height: 23px; }
.compact .width-value { width: 66px; }
.compact .width-unit { width: 43px; }
</style>
