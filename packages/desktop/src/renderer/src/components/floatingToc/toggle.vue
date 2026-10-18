<template>
  <button
    class="floating-toc-toggle"
    data-testid="floating-toc-toggle"
    type="button"
    role="switch"
    :aria-checked="floatingTocEnabled"
    :aria-label="t('floatingToc.toggle')"
    :title="t(floatingTocEnabled ? 'floatingToc.disable' : 'floatingToc.enable')"
    @mousedown.prevent
    @click="toggle"
  >
    <span>{{ t('floatingToc.toggle') }}</span>
    <span
      class="switch-track"
      :class="{ enabled: floatingTocEnabled }"
      aria-hidden="true"
    ><span /></span>
  </button>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/store/preferences'

const { t } = useI18n()
const preferencesStore = usePreferencesStore()
const { floatingTocEnabled } = storeToRefs(preferencesStore)
const toggle = (): void => {
  preferencesStore.SET_SINGLE_PREFERENCE({ type: 'floatingTocEnabled', value: !floatingTocEnabled.value })
}
</script>

<style scoped>
.floating-toc-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 2px 8px 2px 0;
  margin-right: 4px;
  border: 0;
  border-right: 1px solid var(--editorColor10);
  background: transparent;
  color: var(--editorColor);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.floating-toc-toggle:focus-visible { outline: 2px solid var(--themeColor); outline-offset: 1px; }
.switch-track { width: 28px; height: 16px; border-radius: 12px; background: var(--editorColor30); }
.switch-track > span { display: block; width: 12px; height: 12px; margin: 2px; border-radius: 50%; background: var(--editorBgColor); transition: transform .15s; }
.switch-track.enabled { background: var(--themeColor); }
.switch-track.enabled > span { transform: translateX(12px); }
@media (prefers-reduced-motion: reduce) { .switch-track > span { transition: none; } }
</style>
