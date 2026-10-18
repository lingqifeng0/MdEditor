<template>
  <div class="about-dialog">
    <el-dialog
      v-model="showAboutDialog"
      :show-close="false"
      :modal="true"
      custom-class="ag-dialog-table"
      width="400px"
    >
      <img
        class="logo"
        :src="MarkTextLogo"
      >
      <el-row>
        <el-col :span="24">
          <h3 class="title">
            {{ name }}
          </h3>
        </el-col>
        <el-col :span="24">
          <div class="text">
            {{ store.appVersion }}
          </div>
        </el-col>
        <el-col :span="24">
          <div
            class="text"
            style="min-height: auto"
          >
            {{ t('about.license') }}
          </div>
        </el-col>
        <el-col :span="24">
          <div class="text">
            {{ t('about.attribution') }}
          </div>
        </el-col>
        <el-col :span="24">
          <div class="project-links">
            <button @click="openProject('')">
              {{ t('menu.help.viewSource') }}
            </button>
            <button @click="openProject('/blob/main/LICENSE')">
              {{ t('menu.help.license') }}
            </button>
            <button @click="openProject('/blob/main/NOTICE.md')">
              {{ t('menu.help.openSourceNotices') }}
            </button>
          </div>
        </el-col>
      </el-row>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useMainStore } from '@/store'
import bus from '../../bus'
import MarkTextLogo from '../../assets/images/logo.png'
import { useI18n } from 'vue-i18n'
import { APP_NAME, APP_REPOSITORY_URL } from 'common/appIdentity'

const { t } = useI18n()

const name = APP_NAME
const openProject = (suffix: string): Promise<void> => window.electron.shell.openExternal(APP_REPOSITORY_URL + suffix)
const showAboutDialog = ref(false)

const store = useMainStore()

const showDialog = () => {
  showAboutDialog.value = true
  bus.emit('editor-blur')
}

onMounted(() => {
  bus.on('aboutDialog', showDialog)
})

onBeforeUnmount(() => {
  bus.off('aboutDialog', showDialog)
})
</script>

<style>
.about-dialog el-row,
.about-dialog el-col {
  display: block;
}

.about-dialog img.logo {
  width: 80px;
  height: 80px;
  display: inherit;
  margin: 0 auto;
}

.about-dialog .title,
.about-dialog .text {
  min-height: 32px;
  text-align: center;
}

.about-dialog .title {
  color: var(--floatFontColor);
}

.about-dialog .text {
  color: var(--floatFontColor);
}

.about-dialog .project-links {
  display: flex;
  justify-content: center;
  gap: 14px;
  margin-top: 12px;
}

.about-dialog .project-links button {
  border: 0;
  background: transparent;
  color: var(--themeColor);
  font: inherit;
  cursor: pointer;
}
</style>
