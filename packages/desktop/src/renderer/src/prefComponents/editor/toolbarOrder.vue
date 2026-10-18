<template>
  <compound
    class="toolbar-order"
    data-testid="toolbar-order-settings"
  >
    <template #head>
      <div class="order-heading">
        <h6 class="title">
          {{ t('toolbarSettings.title') }}
        </h6>
        <button
          type="button"
          class="reset-order"
          :disabled="isDefault"
          @click="reset"
        >
          {{ t('toolbarSettings.reset') }}
        </button>
      </div>
    </template>
    <template #children>
      <p class="order-description">
        {{ t('toolbarSettings.description') }}
      </p>
      <div
        ref="strip"
        class="order-strip"
        :aria-label="t('toolbarSettings.title')"
        role="group"
        @dragover="autoScroll"
        @dragleave="leaveStrip"
        @keydown.stop
        @keydown.esc="clearDrag"
      >
        <button
          v-for="id in order"
          :key="id"
          type="button"
          class="toolbar-slot"
          :class="{ dragging: dragged === id, 'swap-target': dropTarget === id && dragged !== id }"
          :data-toolbar-button="id"
          draggable="true"
          :aria-label="label(id)"
          :title="label(id)"
          @dragstart="dragStart($event, id)"
          @dragend="clearDrag"
          @dragover="dragOver($event, id)"
          @drop="drop($event, id)"
          @dragleave="leave($event, id)"
          @keydown.alt.left.prevent="swapAdjacent(id, -1)"
          @keydown.alt.right.prevent="swapAdjacent(id, 1)"
        >
          <toolbar-button-icon :id="id" />
        </button>
      </div>
      <span
        class="order-status"
        role="status"
      >{{ status }}</span>
    </template>
  </compound>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { normalizeToolbarOrder, swapToolbarButtons, TOOLBAR_BUTTONS, type ToolbarButton } from 'common/toolbar'
import { usePreferencesStore } from '@/store/preferences'
import Compound from '../common/compound/index.vue'
import ToolbarButtonIcon from './toolbarButtonIcon.vue'

const { t } = useI18n()
const preferences = usePreferencesStore()
const order = computed(() => normalizeToolbarOrder(preferences.toolbarButtonOrder))
const isDefault = computed(() => order.value.every((id, index) => id === TOOLBAR_BUTTONS[index]))
const strip = ref<HTMLElement | null>(null)
const dragged = ref<ToolbarButton | null>(null)
const dropTarget = ref<ToolbarButton | null>(null)
const status = ref('')
let scrollFrame = 0
let scrollSpeed = 0
const label = (id: ToolbarButton): string => t(`toolbarSettings.buttons.${id}`)

const save = (value: ToolbarButton[]): void => {
  if (value.every((id, index) => id === order.value[index])) return
  preferences.SET_SINGLE_PREFERENCE({ type: 'toolbarButtonOrder', value })
  status.value = t('toolbarSettings.saved')
}

const stopScrolling = (): void => {
  cancelAnimationFrame(scrollFrame)
  scrollFrame = 0
  scrollSpeed = 0
}

const clearDrag = (): void => {
  dragged.value = null
  dropTarget.value = null
  stopScrolling()
}

const reset = (): void => {
  clearDrag()
  save([...TOOLBAR_BUTTONS])
  strip.value?.scrollTo({ left: 0 })
}

const swapAdjacent = async (id: ToolbarButton, direction: number): Promise<void> => {
  const target = order.value[order.value.indexOf(id) + direction]
  if (!target) return
  save(swapToolbarButtons(order.value, id, target))
  await nextTick()
  strip.value?.querySelector<HTMLElement>(`[data-toolbar-button="${id}"]`)?.focus()
}

const dragStart = (event: DragEvent, id: ToolbarButton): void => {
  if (!event.dataTransfer) return
  dragged.value = id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-marktext-toolbar-button', id)
}

const scroll = (): void => {
  if (!dragged.value || !strip.value || !scrollSpeed) {
    stopScrolling()
    return
  }
  strip.value.scrollLeft += scrollSpeed
  scrollFrame = requestAnimationFrame(scroll)
}

const autoScroll = (event: DragEvent): void => {
  if (!dragged.value || !strip.value) return
  const box = strip.value.getBoundingClientRect()
  scrollSpeed = event.clientX < box.left + 28 ? -6 : event.clientX > box.right - 28 ? 6 : 0
  if (!scrollSpeed) stopScrolling()
  else if (!scrollFrame) scrollFrame = requestAnimationFrame(scroll)
}

const dragOver = (event: DragEvent, id: ToolbarButton): void => {
  if (!dragged.value || !event.dataTransfer) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dropTarget.value = id
}

const drop = (event: DragEvent, id: ToolbarButton): void => {
  if (!dragged.value) return
  event.preventDefault()
  save(swapToolbarButtons(order.value, dragged.value, id))
  clearDrag()
}

const leave = (event: DragEvent, id: ToolbarButton): void => {
  const next = event.relatedTarget
  if (dropTarget.value === id && (!(next instanceof Node) || !(event.currentTarget as HTMLElement).contains(next))) dropTarget.value = null
}

const leaveStrip = (event: DragEvent): void => {
  if (!(event.relatedTarget instanceof Node) || !strip.value?.contains(event.relatedTarget)) {
    dropTarget.value = null
    stopScrolling()
  }
}

onBeforeUnmount(clearDrag)
</script>

<style scoped>
.order-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.order-heading .title { margin: 0; }
.order-description { color: var(--editorColor80); line-height: 1.6; }
.order-strip { display: flex; flex-wrap: nowrap; gap: 4px; overflow-x: auto; padding: 10px; margin: 12px 0 8px; border: 1px solid var(--editorColor10); border-radius: 7px; background: var(--floatBgColor); scrollbar-width: thin; scrollbar-color: var(--editorColor30) var(--floatBgColor); }
.order-strip::-webkit-scrollbar { height: 6px; }
.order-strip::-webkit-scrollbar-track { background: transparent; }
.order-strip::-webkit-scrollbar-thumb { background: var(--editorColor30); border-radius: 3px; }
.toolbar-order button { color: var(--editorColor); border-radius: 4px; }
.toolbar-order .toolbar-slot { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 36px; height: 38px; padding: 5px; border: 1px solid var(--editorColor30); background: var(--editorColor04); cursor: grab; }
.toolbar-slot:hover { background: var(--editorColor10); }
.toolbar-slot:active { cursor: grabbing; }
.toolbar-slot:focus-visible { outline: 2px solid var(--themeColor); outline-offset: -2px; }
.toolbar-slot.dragging { opacity: 0.4; }
.toolbar-order .toolbar-slot.swap-target { border-color: var(--themeColor); box-shadow: inset 0 0 0 1px var(--themeColor); background: var(--editorColor10); }
.toolbar-order .reset-order { padding: 7px 10px; white-space: nowrap; border: 1px solid var(--editorColor30); background: var(--floatBgColor); cursor: pointer; }
.reset-order:hover:not(:disabled) { background: var(--editorColor10); }
.reset-order:disabled { opacity: 0.4; cursor: default; }
.order-status { display: block; min-height: 18px; color: var(--editorColor80); font-size: 12px; }
</style>
