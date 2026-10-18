<template>
  <div class="pref-image">
    <h4>{{ t('preferences.image.title') }}</h4>
    <section class="image-ctrl">
      <div>{{ t('preferences.image.defaultBehavior') }}</div>
      <CurSelect
        :value="imageInsertAction"
        :options="imageActions"
        :on-change="(value) => onSelectChange('imageInsertAction', value)"
      />
    </section>
    <Separator />
    <section class="external-image-editor">
      <h6 class="title">
        {{ t('preferences.image.externalEditor.title') }}
      </h6>
      <TextBox
        data-testid="image-editor-program-path"
        :description="t('preferences.image.externalEditor.path')"
        :input="imageEditorPath"
        :notes="t('preferences.image.externalEditor.notes')"
        :emit-time="0"
        :on-change="(value) => onSelectChange('imageEditorPath', value)"
      />
      <el-button
        size="small"
        data-testid="image-editor-choose-program"
        :loading="choosingEditor"
        @click="chooseEditor"
      >
        {{ t('preferences.image.externalEditor.choose') }}
      </el-button>
      <el-button
        size="small"
        data-testid="image-editor-clear-program"
        :disabled="!imageEditorPath"
        @click="onSelectChange('imageEditorPath', '')"
      >
        {{ t('preferences.image.externalEditor.clear') }}
      </el-button>
    </section>
    <Separator />
    <FolderSetting v-if="imageInsertAction === 'folder' || imageInsertAction === 'path'" />
    <Uploader v-if="imageInsertAction === 'upload'" />
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/store/preferences'
import type { PreferencesState } from '@/store/preferences'
import Separator from '../common/separator/index.vue'
import Uploader from './components/uploader/index.vue'
import CurSelect from '../common/select/index.vue'
import FolderSetting from './components/folderSetting/index.vue'
import { getImageActions } from './config'
import TextBox from '../common/textBox/index.vue'

const { t } = useI18n()

const preferenceStore = usePreferencesStore()

const { imageInsertAction, imageEditorPath } = storeToRefs(preferenceStore)
const choosingEditor = ref(false)

const imageActions = getImageActions()

const onSelectChange = (type: keyof PreferencesState, value: unknown): void => {
  preferenceStore.SET_SINGLE_PREFERENCE({ type, value })
}

const chooseEditor = async (): Promise<void> => {
  choosingEditor.value = true
  try {
    const selected = await window.electron.images.chooseEditor(imageEditorPath.value)
    if (selected) onSelectChange('imageEditorPath', selected)
  } finally {
    choosingEditor.value = false
  }
}
</script>

<style>
.pref-image {
  & .image-ctrl {
    font-size: 14px;
    margin: 20px 0;
    color: var(--editorColor);
    & label {
      display: block;
      margin: 20px 0;
    }
  }
}
</style>
