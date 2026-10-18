<template>
  <div v-if="commands.length" class="plugin-toolbar" data-plugin-toolbar>
    <details class="plugin-commands">
      <summary>插件命令</summary>
      <div class="plugin-command-list">
        <button v-for="command in commands" :key="key(command)" @click="execute(command)">{{ command.definition.name }}</button>
      </div>
    </details>
    <button v-for="button in toolbarButtons" :key="key(button)" :title="String(button.definition.label)" @mousedown.prevent @click="executeButton(button)">{{ button.definition.icon || button.definition.label }}</button>
    <span v-if="error" class="plugin-error" role="alert">{{ error }}</span>
  </div>
  <div v-if="statusButtons.length" class="plugin-statusbar" data-plugin-statusbar>
    <button v-for="button in statusButtons" :key="key(button)" :title="String(button.definition.label)" @mousedown.prevent @click="executeButton(button)">{{ button.definition.icon || button.definition.label }}</button>
  </div>
  <div v-for="view in openPluginViews" :key="key(view.registration)" class="plugin-view-container" :class="String(view.registration.definition.placement)">
    <section class="plugin-view">
      <header><strong>{{ view.registration.definition.title }}</strong><button title="关闭插件视图" @click="close(view.registration)">×</button></header>
      <plugin-frame :registration="view.registration" :data="view.data" />
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import type { PluginRegistration } from '@shared/plugin-api'
import { platform, openPluginViews, initializePluginPlatform, control } from './runtime'
import PluginFrame from './PluginFrame.vue'
const commands = computed(() => platform.value.registrations.filter(r => r.kind === 'command'))
const toolbarButtons = computed(() => platform.value.registrations.filter(r => r.kind === 'button' && r.definition.placement === 'toolbar'))
const statusButtons = computed(() => platform.value.registrations.filter(r => r.kind === 'button' && r.definition.placement === 'statusbar'))
const error = ref('')
const key = (r: PluginRegistration): string => `${r.owner}:${r.kind}:${r.id}`
async function execute(command: PluginRegistration): Promise<void> {
  error.value = ''
  try { await control('execute', { owner: command.owner, id: command.id }) } catch (e) { error.value = String(e) }
}
async function executeButton(button: PluginRegistration): Promise<void> {
  const command = commands.value.find(command => command.owner === button.owner && command.id === button.definition.commandId)
  if (command) await execute(command)
}
function close(registration: PluginRegistration): void { openPluginViews.value = openPluginViews.value.filter(view => key(view.registration) !== key(registration)) }
function onKey(event: KeyboardEvent): void {
  for (const command of commands.value) {
    const binding = String(command.definition.hotkey ?? '').split('+')
    if (binding.length < 2) continue
    const key = binding.pop()!.toLowerCase()
    const ctrl = binding.includes('Ctrl') || (binding.includes('CmdOrCtrl') && window.electron.process.platform !== 'darwin')
    const meta = binding.includes('Meta') || (binding.includes('CmdOrCtrl') && window.electron.process.platform === 'darwin')
    if (event.key.toLowerCase() === key && event.ctrlKey === ctrl && event.metaKey === meta && event.altKey === binding.includes('Alt') && event.shiftKey === binding.includes('Shift')) {
      event.preventDefault()
      void execute(command)
      break
    }
  }
}
onMounted(() => { initializePluginPlatform(true).catch(e => { error.value = String(e) }); window.addEventListener('keydown', onKey) })
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
<style scoped>
.plugin-toolbar { position: absolute; top: calc(var(--titleBarHeight) + 34px); right: 20px; z-index: 600; display: flex; align-items: center; gap: 6px; font-size: 13px; background: var(--floatBgColor); padding: 5px 8px; border-radius: 6px; }
.plugin-statusbar { position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%); z-index: 600; display: flex; align-items: center; gap: 6px; font-size: 12px; }
button,summary { cursor: pointer; color: var(--editorColor); background: var(--floatBgColor); border: 1px solid var(--floatBorderColor); padding: 4px 8px; border-radius: 4px; font: inherit; }
.plugin-command-list { position: absolute; right: 0; max-height: 320px; overflow: auto; min-width: 220px; background: var(--floatBgColor); display: flex; flex-direction: column; padding: 6px; }
.plugin-view-container { position: fixed; z-index: 800; color: var(--editorColor); }
.plugin-view-container.sidebar { top: 90px; bottom: 60px; right: 18px; width: 360px; }
.plugin-view-container.bottom { bottom: 50px; left: 25%; right: 20px; height: 280px; }
.plugin-view-container.tab { top: 85px; bottom: 60px; left: 25%; right: 20px; }
.plugin-view-container.dialog { inset: 0; display: grid; place-items: center; background: #0008; }
.plugin-view { background: var(--editorBgColor); border: 1px solid var(--floatBorderColor); box-shadow: 0 8px 30px #0006; border-radius: 8px; overflow: hidden; height: 100%; display: flex; flex-direction: column; }
.dialog .plugin-view { width: min(760px, 85vw); height: min(600px, 80vh); }
header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; flex: none; }
.plugin-error { color: #ffad72; max-width: 340px; }
</style>
