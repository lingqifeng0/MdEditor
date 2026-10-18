<template>
  <Teleport to="body">
    <div
      v-if="prompt"
      class="image-operation-overlay"
      data-testid="image-operation-dialog"
      @keydown.stop="handleKeydown"
      @click.stop
      @contextmenu.prevent
    >
      <section
        ref="dialog"
        class="image-operation-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="prompt.title"
        tabindex="-1"
      >
        <header>
          <strong>{{ prompt.title }}</strong>
          <button
            type="button"
            aria-label="关闭"
            data-testid="image-operation-close"
            :disabled="prompt.busy"
            @click="finishImageOperation(false)"
          >
            ×
          </button>
        </header>
        <p>{{ prompt.message }}</p>
        <p
          v-if="prompt.error"
          class="image-operation-error"
          role="alert"
        >
          {{ prompt.error }}
        </p>
        <footer :class="{ 'image-removal-actions': prompt.secondaryLabel }">
          <button
            type="button"
            data-testid="image-operation-cancel"
            class="image-operation-cancel"
            :disabled="prompt.busy"
            @click="finishImageOperation(false)"
          >
            取消
          </button>
          <button
            v-if="prompt.secondaryLabel"
            type="button"
            class="image-operation-secondary"
            data-testid="image-operation-links-only"
            :disabled="prompt.busy"
            @click="finishImageOperation('links')"
          >
            {{ prompt.secondaryLabel }}
          </button>
          <button
            type="button"
            class="image-operation-confirm"
            data-testid="image-operation-confirm"
            :disabled="prompt.busy"
            @click="confirmImageOperation"
          >
            {{ prompt.busy ? '正在处理…' : prompt.confirmLabel || '确定' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { imageOperationPrompt as prompt, finishImageOperation, confirmImageOperation } from '@/util/imageOperationDialog'

const dialog = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null
watch(prompt, async (value, previous) => {
  if (value && !previous) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    dialog.value?.focus({ preventScroll: true })
  } else if (!value && previous) {
    const focus = previousFocus
    previousFocus = null
    await nextTick()
    if (focus?.isConnected && !focus.isContentEditable) focus.focus({ preventScroll: true })
  }
})
const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') event.preventDefault()
  if (event.key !== 'Tab') return
  const buttons = [...(dialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
  if (!buttons.length) { event.preventDefault(); return }
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === buttons.length - 1)) {
    event.preventDefault()
    buttons[event.shiftKey ? buttons.length - 1 : 0]?.focus({ preventScroll: true })
  }
}
</script>

<style>
.image-operation-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.image-operation-dialog {
  width: min(540px, calc(100vw - 48px));
  padding: 20px;
  border: 1px solid var(--editor-border-color, #777);
  border-radius: 8px;
  background: var(--editor-bg-color, #282828);
  color: var(--editor-color, #ddd);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  font-size: 15px;
  outline: none;
}
.image-operation-dialog header, .image-operation-dialog footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.image-operation-dialog p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 20px 0; line-height: 1.7; }
.image-operation-dialog footer { justify-content: flex-end; }
.image-operation-dialog button { border: 1px solid #777; border-radius: 4px; background: transparent; color: inherit; padding: 7px 18px; cursor: pointer; }
.image-operation-dialog button:disabled { opacity: 0.5; cursor: default; }
.image-operation-dialog header button { padding: 0 8px; border: 0; font-size: 24px; }
.image-operation-dialog .image-operation-confirm { background: #409eff; color: white; border-color: #409eff; }
.image-operation-dialog .image-operation-error { color: #f56c6c; }
.image-removal-actions .image-operation-confirm { order: 0; }
.image-removal-actions .image-operation-secondary { order: 1; opacity: 0.65; }
.image-removal-actions .image-operation-cancel { order: 2; background: #409eff; color: white; border-color: #409eff; }
</style>
