<template>
  <div
    v-if="currentNotification"
    class="editor-notifications"
    :class="currentNotification.style"
    :style="{ 'max-width': `calc(100vw - ${effectiveSideBarWidth}px)` }"
  >
    <div
      class="notification-content"
      :class="{ 'has-confirm': currentNotification.showConfirm }"
    >
      <div
        class="msg"
        role="status"
      >
        {{ currentNotification.msg }}
      </div>
      <button
        v-if="currentNotification.showConfirm"
        type="button"
        class="inline-button confirm"
        @click.stop="handleClick(true)"
      >
        {{ t('common.ok') }}
      </button>
      <button
        type="button"
        class="inline-button dismiss"
        :aria-label="t('dialog.close')"
        @click.stop="handleClick(false)"
      >
        <el-icon
          :size="12"
          aria-hidden="true"
        >
          <Close />
        </el-icon>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '@/store/editor'
import { useLayoutStore } from '@/store/layout'
import { storeToRefs } from 'pinia'
import { Close } from '@element-plus/icons-vue'
import { t } from '../../i18n'

const editorStore = useEditorStore()
const layoutStore = useLayoutStore()

const { currentFile } = storeToRefs(editorStore)
const { effectiveSideBarWidth } = storeToRefs(layoutStore)

const currentNotification = computed(() => {
  const notifications = currentFile.value?.notifications
  if (!notifications || notifications.length === 0) {
    return null
  }
  return notifications[0]
})

const handleClick = (status: boolean) => {
  const notifications = currentFile.value?.notifications
  if (!notifications || notifications.length === 0) {
    console.error(t('editor.notifications.notificationNotFound'))
    return
  }

  const item = notifications.shift()
  const action = item?.action
  if (action) {
    action(status)
  }
}
</script>

<style scoped>
.editor-notifications {
  position: relative;
  container: tab-notification / inline-size;
  margin-top: 4px;
  background: var(--notificationPrimaryBg);
  color: var(--notificationPrimaryColor);
  padding: 8px 10px;
  user-select: none;
  &.warn {
    background: var(--notificationWarningBg);
    color: var(--notificationWarningColor);
  }
  &.crit {
    background: var(--notificationErrorBg);
    color: var(--notificationErrorColor);
  }
}
.notification-content {
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr) auto;
  grid-template-areas: "message . dismiss";
  align-items: center;
  gap: 8px;

  &.has-confirm {
    grid-template-columns: minmax(0, max-content) auto minmax(20px, 1fr) auto;
    grid-template-areas: "message confirm . dismiss";
  }
}
.msg {
  grid-area: message;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.inline-button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-height: 26px;
  padding: 3px 10px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: transparent;
  border: 1px solid currentColor;
  border-radius: 4px;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, currentColor 12%, transparent);
  }
  &:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
}
.confirm {
  grid-area: confirm;
  justify-self: start;
}
.dismiss {
  grid-area: dismiss;
  align-self: start;
  width: 26px;
  padding: 0;
  border-color: transparent;
}
@container tab-notification (max-width: 440px) {
  .notification-content.has-confirm {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "message dismiss"
      "confirm .";
  }
}
</style>
