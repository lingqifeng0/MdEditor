<template>
  <section class="plugin-settings-page">
    <button
      class="back-button"
      @click="router.push({ name: 'plugins' })"
    >
      ‹ 返回插件管理
    </button>
    <h2>{{ plugin?.manifest.name ?? '插件设置' }}</h2>
    <p v-if="!plugin">
      此插件已卸载。
    </p>
    <p v-else-if="plugin.status !== 'active'">
      插件尚未启用。请返回插件管理，启用后再打开它提供的设置。
    </p>
    <p v-else-if="!settings.length">
      此插件没有设置页面。
    </p>
    <p
      v-if="error"
      class="plugin-error"
      role="alert"
    >
      {{ error }}
    </p>
    <p v-if="loading">
      正在读取设置…
    </p>
    <template v-else-if="plugin?.status === 'active'">
      <section
        v-for="setting in settings"
        :key="setting.id"
        class="plugin-settings"
      >
        <h3>{{ setting.definition.title }}</h3>
        <label
          v-for="field in fields(setting)"
          :key="field.key"
        >
          <span>{{ field.label }}<small>{{ field.description }}</small></span>
          <input
            v-if="field.type === 'toggle'"
            v-model="values[field.key]"
            type="checkbox"
            :disabled="saving"
            @change="save(setting)"
          >
          <select
            v-else-if="field.type === 'select'"
            v-model="values[field.key]"
            :disabled="saving"
            @change="save(setting)"
          ><option
            v-for="option in field.options"
            :key="option.value"
            :value="option.value"
          >{{ option.label }}</option></select>
          <input
            v-else-if="field.type === 'number'"
            v-model.number="values[field.key]"
            type="number"
            :min="field.min"
            :max="field.max"
            :disabled="saving"
            @change="save(setting)"
          >
          <input
            v-else
            v-model="values[field.key]"
            type="text"
            :disabled="saving"
            @change="save(setting)"
          >
        </label>
        <plugin-frame
          v-if="settingView(setting)"
          :registration="settingView(setting)!"
          auto-height
        />
      </section>
    </template>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import type { Json, PluginRegistration, SettingField } from '@shared/plugin-api'
import { platform, initializePluginPlatform, control } from '@/plugins/runtime'
import PluginFrame from '@/plugins/PluginFrame.vue'

const route = useRoute()
const router = useRouter()
const owner = computed(() => String(route.params.pluginId ?? ''))
const plugin = computed(() => platform.value.plugins.find(plugin => plugin.manifest.id === owner.value))
const settings = computed(() => platform.value.registrations.filter(registration => registration.owner === owner.value && registration.kind === 'settings'))
const values = ref<Record<string, Json>>({})
const error = ref('')
const loading = ref(false)
const saving = ref(false)
let generation = 0
const fields = (registration: PluginRegistration): SettingField[] => registration.definition.fields as SettingField[] ?? []
const settingView = (registration: PluginRegistration): PluginRegistration | undefined => platform.value.registrations.find(view => view.owner === registration.owner && view.kind === 'view' && view.id === registration.definition.viewId)
async function load (): Promise<void> {
  const current = ++generation
  const id = owner.value
  error.value = ''
  values.value = {}
  loading.value = plugin.value?.status === 'active' && settings.value.length > 0
  if (!loading.value) return
  try { const data = await control<Record<string, Json>>('settings-read', id); if (current === generation) values.value = data } catch (e) { if (current === generation) error.value = String(e) } finally { if (current === generation) loading.value = false }
}
async function save (registration: PluginRegistration): Promise<void> {
  if (saving.value) return
  const current = generation
  saving.value = true
  error.value = ''
  try { await control('settings-save', { owner: registration.owner, id: registration.id, values: values.value }) } catch (e) { if (current === generation) error.value = String(e) } finally { saving.value = false }
}
watch(() => JSON.stringify([owner.value, plugin.value?.status, settings.value.map(setting => [setting.id, setting.definition])]), () => { load() }, { immediate: true })
onMounted(() => { initializePluginPlatform().catch(e => { error.value = String(e) }) })
onUnmounted(() => { generation++ })
</script>
<style scoped>
.plugin-settings-page { color: var(--editorColor); }
button,input,select { font: inherit; color: var(--editorColor); background: var(--floatBgColor); border: 1px solid var(--floatBorderColor); border-radius: 5px; padding: 7px 12px; }
button { cursor: pointer; }
.back-button { margin-bottom: 8px; }
.plugin-settings { margin: 24px 0; }
.plugin-settings h3 { margin-top: 0; }
label { display: flex; gap: 16px; justify-content: space-between; align-items: center; padding: 10px 0; }
small { display: block; opacity: .7; font-size: 12px; margin-top: 4px; }
.plugin-error { color: #ffad72; white-space: pre-wrap; }
</style>
