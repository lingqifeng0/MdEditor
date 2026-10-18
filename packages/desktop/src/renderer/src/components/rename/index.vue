<template>
  <div class="rename">
    <el-dialog
      v-model="showRename"
      :show-close="false"
      :modal="true"
      :title="t('contextMenu.tabs.renameFile')"
      class="ag-dialog-table rename-file-dialog"
      width="410px"
    >
      <template #header>
        <div class="search-wrapper">
          <div class="input-wrapper">
            <input
              ref="search"
              v-model="tempName"
              type="text"
              class="search"
              :aria-label="t('contextMenu.tabs.renameFile')"
              data-testid="rename-file-input"
              @input="errorMessage = ''"
              @keyup.enter="confirm"
            >
          </div>
          <p
            v-if="errorMessage"
            class="rename-error"
            role="alert"
            data-testid="rename-file-error"
          >
            {{ errorMessage }}
          </p>
        </div>
      </template>
      <template #footer>
        <el-button
          data-testid="rename-file-cancel"
          @click="showRename = false"
        >
          {{ t('dialog.cancel') }}
        </el-button>
        <el-button
          type="primary"
          data-testid="rename-file-confirm"
          @click="confirm"
        >
          {{ t('contextMenu.tabs.renameFile') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import bus from '../../bus'
import { useEditorStore } from '@/store/editor'
import { t } from '../../i18n'

const showRename = ref(false)
const tempName = ref('')
const search = ref<HTMLInputElement | null>(null)
const targetTabId = ref('')
const errorMessage = ref('')

const editorStore = useEditorStore()

const handleRename = (tabId: unknown) => {
  const file =
    editorStore.tabs.find((tab) => tab.id === tabId) ??
    (tabId === undefined ? editorStore.currentFile : null)
  if (!file?.pathname) return
  targetTabId.value = file.id
  showRename.value = true
  tempName.value = file.filename
  errorMessage.value = ''
  nextTick(() => {
    if (search.value) {
      search.value.focus()
      const extension = window.path.extname(file.filename)
      search.value.setSelectionRange(0, file.filename.length - extension.length)
    }
  })
}

const confirm = () => {
  if (editorStore.RENAME(tempName.value, targetTabId.value)) {
    showRename.value = false
  } else {
    errorMessage.value = t('contextMenu.tabs.invalidFilename')
  }
}

onMounted(() => {
  bus.on('rename', handleRename)
})

onBeforeUnmount(() => {
  bus.off('rename', handleRename)
})
</script>

<style>
.rename-file-dialog .el-dialog__header {
  box-sizing: border-box;
}
.rename-file-dialog .el-dialog__body {
  display: none;
}
</style>

<style scoped>
.search-wrapper {
  margin-top: 8px;
  z-index: 10000;
  position: relative;
  left: 50%;
  transform: translateX(-50%);
  width: 410px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: none;
  border: none;
  border-radius: 3px;
  margin: 0;
  padding: 0 8px;

  & .input-wrapper {
    display: flex;
    width: 100%;
    & input {
      background: transparent;
    }
  }
}
.search {
  width: 100%;
  height: 30px;
  outline: none;
  border: none;
  font-size: 14px;
  padding: 0 8px;
  margin: 0 10px;
  color: var(--sideBarColor);
}
.rename-error {
  align-self: stretch;
  margin: 6px 10px 0;
  color: var(--highlightThemeColor);
  font-size: 12px;
}
</style>
