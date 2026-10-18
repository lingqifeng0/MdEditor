<template>
  <section
    class="plugin-management"
    @dragenter.prevent.stop="dragEnter"
    @dragover.prevent.stop="dragOver"
    @dragleave.prevent.stop="dragLeave"
    @drop.prevent.stop="drop"
  >
    <h2>插件</h2>
    <p>导入本地 .mtplug 安装包或插件文件夹。插件独立运行，设置由插件自己提供。</p>
    <div
      class="plugin-drop-zone"
      :class="{ 'is-dragging': dragging, 'is-busy': busy }"
    >
      <strong>{{ busy ? '正在处理插件…' : dragging ? '松开鼠标即可导入' : '将插件文件拖到此页面' }}</strong>
      <p>支持 .mtplug 安装包或插件文件夹，每次拖入一个。</p>
    </div>
    <div class="plugin-paths">
      <h3>用户数据与插件目录</h3>
      <p>用户数据：{{ platform.paths.userData }}</p>
      <p>插件程序：{{ platform.paths.plugins }}</p>
      <p>插件数据：{{ platform.paths.data }}</p>
      <div class="plugin-actions">
        <button @click="run('open-folder', 'plugins')">
          打开插件文件夹
        </button>
        <button @click="run('open-folder', 'data')">
          打开插件数据文件夹
        </button>
      </div>
    </div>
    <div class="plugin-actions">
      <button
        class="primary"
        :disabled="busy"
        @click="run('choose-install')"
      >
        安装 / 更新插件…
      </button>
      <button
        :disabled="busy"
        @click="run('choose-folder')"
      >
        导入文件夹
      </button>
      <button
        :disabled="busy"
        @click="refresh"
      >
        刷新
      </button>
    </div>
    <p
      v-if="error"
      class="plugin-error"
      role="alert"
    >
      {{ error }}
    </p>
    <p v-if="!platform.plugins.length">
      尚未安装插件。安装后，有设置项的插件会显示自己的设置入口。
    </p>
    <article
      v-for="plugin in platform.plugins"
      :key="plugin.manifest.id"
      class="plugin-card"
      :data-plugin-id="plugin.manifest.id"
    >
      <header><strong>{{ plugin.manifest.name }}</strong><span>{{ plugin.manifest.version }}</span><span>{{ statusLabels[plugin.status] }}</span></header>
      <p class="plugin-id">
        {{ plugin.manifest.id }}
      </p>
      <p v-if="plugin.manifest.description">
        {{ plugin.manifest.description }}
      </p>
      <p
        v-if="plugin.error"
        class="plugin-error"
      >
        {{ plugin.error }}
      </p>
      <details v-if="plugin.manifest.permissions.length">
        <summary>接口权限（{{ plugin.manifest.permissions.length }}）</summary><p>{{ plugin.manifest.permissions.join('、') }}</p>
      </details>
      <div class="plugin-actions">
        <button
          class="primary"
          :disabled="busy || plugin.status === 'starting'"
          @click="run(plugin.enabled ? 'disable' : 'enable', plugin.manifest.id)"
        >
          {{ plugin.enabled ? '停用' : '启用' }}
        </button>
        <button
          :disabled="busy || !hasSettings(plugin.manifest.id)"
          :title="plugin.status !== 'active' ? '启用插件后可打开它提供的设置' : !hasSettings(plugin.manifest.id) ? '此插件没有设置页面' : '打开此插件的设置'"
          @click="router.push({ name: 'plugin-settings', params: { pluginId: plugin.manifest.id } })"
        >
          设置
        </button>
        <button
          :disabled="busy"
          @click="run('open-plugin-data', plugin.manifest.id)"
        >
          打开数据
        </button>
        <button
          :aria-expanded="logOwner === plugin.manifest.id"
          @click="toggleLogs(plugin.manifest.id)"
        >
          {{ logOwner === plugin.manifest.id ? '收起日志' : '查看日志' }}
        </button>
        <button
          :disabled="busy"
          @click="run('uninstall', plugin.manifest.id)"
        >
          卸载
        </button>
      </div>
      <section
        v-if="logOwner === plugin.manifest.id"
        class="plugin-log-panel"
      >
        <div class="plugin-log-header">
          <strong>插件日志</strong><button
            :disabled="logLoading"
            @click="loadLogs"
          >
            刷新日志
          </button>
        </div>
        <p>显示最近 128 KiB 日志，包含启动、停用、插件输出与错误。停用后仍可查看。</p>
        <pre
          aria-live="polite"
          class="plugin-log-output"
        >{{ logText || (logLoading ? '正在读取日志…' : '暂无日志。') }}</pre>
      </section>
    </article>
  </section>
</template>
<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import type { PluginPlatformState, PluginSummary } from '@shared/plugin-api'
import { platform, initializePluginPlatform, control } from '@/plugins/runtime'

const router = useRouter()
const busy = ref(false)
const error = ref('')
const dragging = ref(false)
const logOwner = ref('')
const logText = ref('')
const logLoading = ref(false)
let dragDepth = 0
let logGeneration = 0
let logTimer: ReturnType<typeof setInterval> | undefined
const statusLabels: Record<PluginSummary['status'], string> = { disabled: '已停用', starting: '正在启动', active: '已启用', error: '启动失败' }
const hasSettings = (owner: string): boolean => platform.value.plugins.some(plugin => plugin.manifest.id === owner && plugin.status === 'active') && platform.value.registrations.some(registration => registration.owner === owner && registration.kind === 'settings')
const resetDrag = (): void => { dragDepth = 0; dragging.value = false }
const hasFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files')
function dragEnter (event: DragEvent): void {
  if (!hasFiles(event) || busy.value) return
  dragDepth++
  dragging.value = true
}
function dragOver (event: DragEvent): void {
  if (!event.dataTransfer) return
  const accepted = hasFiles(event) && !busy.value
  event.dataTransfer.dropEffect = accepted ? 'copy' : 'none'
  dragging.value = accepted
}
function dragLeave (): void { if (--dragDepth <= 0) resetDrag() }
async function run (action: string, payload?: unknown): Promise<void> {
  if (busy.value) return
  busy.value = true
  resetDrag()
  error.value = ''
  try { await control(action, payload) } catch (e) { error.value = String(e) } finally { busy.value = false }
}
async function refresh (): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { platform.value = await control<PluginPlatformState>('state') } catch (e) { error.value = String(e) } finally { busy.value = false }
}
async function drop (event: DragEvent): Promise<void> {
  resetDrag()
  if (busy.value) return
  const files = event.dataTransfer?.files
  if (!files?.length) return
  if (files.length !== 1) { error.value = '每次拖入一个插件包或插件文件夹。'; return }
  await run('install', window.electron.webUtils.getPathForFile(files[0]!))
}
async function loadLogs (): Promise<void> {
  const owner = logOwner.value
  if (!owner || logLoading.value) return
  const generation = ++logGeneration
  logLoading.value = true
  try {
    const text = await control<string>('logs-read', owner)
    if (generation === logGeneration && logOwner.value === owner) logText.value = text
  } catch (e) { if (generation === logGeneration) logText.value = `读取日志失败：${String(e)}` } finally { if (generation === logGeneration) logLoading.value = false }
}
function toggleLogs (owner: string): void {
  logGeneration++
  logLoading.value = false
  logOwner.value = logOwner.value === owner ? '' : owner
  logText.value = ''
  loadLogs()
}
watch(() => platform.value.plugins, () => {
  if (logOwner.value && !platform.value.plugins.some(plugin => plugin.manifest.id === logOwner.value)) toggleLogs(logOwner.value)
})
onMounted(() => {
  initializePluginPlatform().catch(e => { error.value = String(e) })
  window.addEventListener('dragend', resetDrag)
  logTimer = setInterval(() => { loadLogs() }, 2000)
})
onUnmounted(() => {
  window.removeEventListener('dragend', resetDrag)
  clearInterval(logTimer)
  logGeneration++
})
</script>
<style scoped>
.plugin-management { color: var(--editorColor); }
.plugin-drop-zone { border: 2px dashed var(--editorColor40); padding: 24px; border-radius: 10px; margin: 20px 0; text-align: center; transition: background-color .15s, border-color .15s; }
.plugin-drop-zone.is-dragging { border-color: var(--themeColor, #409eff); background: var(--selectionColor, #409eff33); }
.plugin-drop-zone.is-busy { opacity: .6; }
.plugin-drop-zone p { opacity: .75; font-size: 13px; }
.plugin-paths,.plugin-card { background: var(--floatBgColor); border: 1px solid var(--floatBorderColor); border-radius: 8px; padding: 18px; margin: 16px 0; }
.plugin-paths { overflow-wrap: anywhere; font-size: 13px; }
.plugin-paths h3 { margin-top: 0; }
.plugin-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0; }
button { font: inherit; color: var(--editorColor); background: var(--sideBarBgColor); border: 1px solid var(--floatBorderColor); border-radius: 5px; padding: 8px 12px; cursor: pointer; }
button:hover:not(:disabled) { background: var(--floatHoverColor); }
button.primary { background: var(--themeColor, #409eff); border-color: transparent; color: white; }
button:disabled { cursor: default; opacity: .45; }
header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
header span,.plugin-id { opacity: .7; font-size: 13px; }
summary { cursor: pointer; }
.plugin-error { color: #ffad72; white-space: pre-wrap; }
.plugin-log-panel { border-top: 1px solid var(--floatBorderColor); padding-top: 12px; }
.plugin-log-header { display: flex; align-items: center; justify-content: space-between; }
.plugin-log-panel p { font-size: 12px; opacity: .7; }
.plugin-log-output { background: var(--sideBarBgColor); padding: 12px; border-radius: 5px; max-height: 300px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.6 monospace; user-select: text; }
</style>
