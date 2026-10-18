<template>
  <section class="image-folder">
    <h6 class="title">
      {{ t('preferences.image.folderSetting.title') }}
    </h6>
    <text-box
      :description="t('preferences.image.folderSetting.globalFolder')"
      :input="imageFolderPath"
      :regex-validator="/^(?:$|([a-zA-Z]:)?[\/\\].*$)/"
      :default-value="folderPathPlaceholder"
      :on-change="(value) => modifyImageFolderPath(value)"
    />
    <div>
      <el-button
        size="mini"
        @click="modifyImageFolderPath(undefined)"
      >
        {{ t('preferences.image.folderSetting.open') }}
      </el-button>
      <el-button
        size="mini"
        @click="openImageFolder"
      >
        {{ t('preferences.image.folderSetting.showInFolder') }}
      </el-button>
    </div>
    <compound>
      <template #head>
        <bool
          :description="t('preferences.image.folderSetting.preferRelative')"
          more="https://marktext.me/docs/images"
          :bool="imagePreferRelativeDirectory || imageStrictRelativeDirectory"
          :on-change="setPreferRelative"
        />
      </template>
      <template #children>
        <bool
          :description="t('preferences.image.folderSetting.strictMode')"
          :bool="imageStrictRelativeDirectory"
          :on-change="setStrictMode"
        />
        <div
          v-if="imageStrictRelativeDirectory"
          class="footnote strict-image-note"
        >
          {{ t('preferences.image.folderSetting.strictNote') }}
        </div>
        <CurSelect
          :description="t('preferences.image.folderSetting.relativeCopyLocation')"
          :value="imageStrictRelativeDirectory ? 'file' : imageRelativeDirectoryBase"
          :disable="!imagePreferRelativeDirectory || imageStrictRelativeDirectory"
          :options="imageRelativeDirectoryBaseOptions"
          :on-change="(value) => onSelectChange('imageRelativeDirectoryBase', value)"
        />
        <CurSelect
          v-if="imageStrictRelativeDirectory"
          :description="t('preferences.image.folderSetting.relativeFolderName')"
          value="assets"
          disable
          :options="strictDirectoryOptions"
          :on-change="(value) => onSelectChange('imageRelativeDirectoryName', value)"
        />
        <text-box
          v-else
          :description="t('preferences.image.folderSetting.relativeFolderName')"
          :input="imageRelativeDirectoryName"
          :disable="!imagePreferRelativeDirectory"
          :regex-validator="/^(?:$|(?![a-zA-Z]:)[^\/\\].*$)/"
          :default-value="relativeDirectoryNamePlaceholder"
          :on-change="(value) => onSelectChange('imageRelativeDirectoryName', value)"
        />
        <div
          v-if="!imageStrictRelativeDirectory"
          class="footnote"
        >
          {{ t('preferences.image.folderSetting.filenameNote') }}
        </div>
      </template>
    </compound>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/store/preferences'
import type { PreferencesState } from '@/store/preferences'
import Bool from '@/prefComponents/common/bool/index.vue'
import Compound from '@/prefComponents/common/compound/index.vue'
import CurSelect from '@/prefComponents/common/select/index.vue'
import TextBox from '@/prefComponents/common/textBox/index.vue'
import type { PrefSelectOption } from '@/prefComponents/common/types'

const { t } = useI18n()

const preferenceStore = usePreferencesStore()

// computed
const {
  imageFolderPath,
  imagePreferRelativeDirectory,
  imageStrictRelativeDirectory,
  imageRelativeDirectoryBase,
  imageRelativeDirectoryName
} = storeToRefs(preferenceStore)
const folderPathPlaceholder = computed<string>(() => preferenceStore.imageFolderPath || '')
const strictDirectoryOptions: PrefSelectOption<string>[] = [{ label: 'assets', value: 'assets' }]
const setPreferRelative = (value: boolean): void => {
  onSelectChange('imagePreferRelativeDirectory', value)
  if (!value) onSelectChange('imageStrictRelativeDirectory', false)
}
const setStrictMode = (value: boolean): void => {
  onSelectChange('imageStrictRelativeDirectory', value)
  if (value) onSelectChange('imagePreferRelativeDirectory', true)
}
const imageRelativeDirectoryBaseOptions = computed<PrefSelectOption<string>[]>(() => [
  {
    label: t('preferences.image.folderSetting.copyRelativeToFile'),
    value: 'file'
  },
  {
    label: t('preferences.image.folderSetting.copyRelativeToFolder'),
    value: 'folder'
  }
])
const relativeDirectoryNamePlaceholder = computed<string>(
  () => preferenceStore.imageRelativeDirectoryName || 'assets'
)

// methods
const openImageFolder = (): void => {
  window.electron.shell.openPath(imageFolderPath.value)
}

const modifyImageFolderPath = (value: string | undefined): void => {
  // Passing `undefined` is the documented way to ask the main process to
  // open a folder picker (see `mt::ask-for-modify-image-folder-path`).
  preferenceStore.SET_IMAGE_FOLDER_PATH(value)
}

const onSelectChange = (type: keyof PreferencesState, value: unknown): void => {
  preferenceStore.SET_SINGLE_PREFERENCE({ type, value })
}
</script>

<style scoped>
.image-folder .footnote {
  font-size: 13px;
  & code {
    font-size: 13px;
  }
}
</style>
