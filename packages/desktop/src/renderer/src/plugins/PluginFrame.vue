<template>
  <p
    v-if="error"
    role="alert"
  >
    {{ error }}
  </p>
  <iframe
    v-else
    ref="frame"
    class="plugin-frame"
    :class="{ 'auto-height': autoHeight }"
    :style="autoHeight ? { height: `${contentHeight}px` } : undefined"
    sandbox="allow-scripts"
    :src="content || undefined"
    :title="String(registration.definition.title ?? registration.id)"
  />
</template>
<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { Json, PluginRegistration } from '@shared/plugin-api'
import { control } from './runtime'

const props = defineProps<{ registration: PluginRegistration; data?: Json; autoHeight?: boolean }>()
const frame = ref<HTMLIFrameElement | null>(null)
const content = ref('')
const error = ref('')
const contentHeight = ref(230)
let generation = 0

async function load (): Promise<void> {
  error.value = ''
  contentHeight.value = 230
  const current = ++generation
  const url = await control<string>('view-url', { owner: props.registration.owner, id: props.registration.id })
  if (current !== generation) { await control('release-view', url).catch(() => {}); return }
  if (content.value) await control('release-view', content.value).catch(() => {})
  content.value = url
}
function sendData (): void { frame.value?.contentWindow?.postMessage({ channel: 'marktext-view', type: 'data', value: props.data ?? null }, '*') }
function sendLayout (): void { frame.value?.contentWindow?.postMessage({ channel: 'marktext-view', type: 'layout', autoHeight: props.autoHeight === true }, '*') }
async function onMessage (event: MessageEvent): Promise<void> {
  if (event.source !== frame.value?.contentWindow || event.data?.channel !== 'marktext-view') return
  if (event.data.ready) { sendLayout(); sendData(); return }
  if (event.data.type === 'content-height') {
    if (props.autoHeight && typeof event.data.height === 'number' && Number.isFinite(event.data.height) && event.data.height > 0) contentHeight.value = Math.min(1_000_000, Math.ceil(event.data.height))
    return
  }
  if (typeof event.data.id !== 'string') return
  const current = generation
  const target = event.source as Window
  try {
    const message = JSON.parse(JSON.stringify(event.data.message)) as Json
    if (JSON.stringify(message).length > 256 * 1024) throw new Error('视图消息过大。')
    const value = await control<Json>('view-message', { owner: props.registration.owner, id: props.registration.id, message })
    if (current === generation) target.postMessage({ channel: 'marktext-view', id: event.data.id, value }, '*')
  } catch (error) { if (current === generation) target.postMessage({ channel: 'marktext-view', id: event.data.id, error: String(error) }, '*') }
}
// State broadcasts replace registration objects; only a changed view identity reloads its UI.
watch(() => `${props.registration.owner}:${props.registration.id}:${props.registration.definition.html}`, () => { load().catch(reason => { error.value = String(reason) }) })
watch(() => props.data, sendData, { deep: true })
watch(() => props.autoHeight, sendLayout)
onMounted(() => { window.addEventListener('message', onMessage); load().catch(reason => { error.value = String(reason) }) })
onBeforeUnmount(() => { generation++; if (content.value) control('release-view', content.value).catch(() => {}); window.removeEventListener('message', onMessage) })
</script>
<style scoped>
.plugin-frame { width: 100%; height: 100%; min-height: 230px; border: 0; display: block; background: var(--editorBgColor); }
.plugin-frame.auto-height { min-height: 0; }
</style>
