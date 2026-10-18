<template>
  <nav
    v-if="entries.length"
    ref="navigation"
    class="floating-toc"
    data-testid="floating-toc"
    :class="{ expanded, pinned: floatingTocPinned }"
    :aria-label="t('floatingToc.title')"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @focusin="focused = true"
    @focusout="handleFocusOut"
    @mousedown.prevent
    @keydown.stop
    @keydown.esc="hovered = false; focused = false"
  >
    <header
      v-show="expanded"
      class="toc-tools"
    >
      <span class="toc-caption">{{ t('floatingToc.title') }}</span>
      <button
        type="button"
        data-toc-action="search"
        :title="t('floatingToc.search')"
        :aria-label="t('floatingToc.search')"
        :aria-pressed="searchOpen"
        @click="toggleSearch"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
        ><circle
          cx="10"
          cy="10"
          r="6"
        /><path d="m15 15 5 5" /></svg>
      </button>
      <button
        type="button"
        data-toc-action="expand-all"
        :title="t('floatingToc.expandAll')"
        :aria-label="t('floatingToc.expandAll')"
        @click="expandAll"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
        ><path d="m6 8 6-5 6 5M6 16l6 5 6-5M5 12h14" /></svg>
      </button>
      <button
        type="button"
        data-toc-action="collapse-all"
        :title="t('floatingToc.collapseAll')"
        :aria-label="t('floatingToc.collapseAll')"
        @click="collapseAll"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
        ><path d="m6 3 6 5 6-5M6 21l6-5 6 5M5 12h14" /></svg>
      </button>
      <button
        type="button"
        data-toc-action="pin"
        :aria-pressed="floatingTocPinned"
        :title="t(floatingTocPinned ? 'floatingToc.unpin' : 'floatingToc.pin')"
        :aria-label="t(floatingTocPinned ? 'floatingToc.unpin' : 'floatingToc.pin')"
        @click="togglePin"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
        ><path d="m9 3 6 0-1 6 4 4v2h-5v6l-1 1-1-1v-6H6v-2l4-4z" /></svg>
      </button>
      <button
        type="button"
        data-toc-action="top"
        :title="t('floatingToc.top')"
        :aria-label="t('floatingToc.top')"
        @click="scrollToEdge(false)"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
        ><path d="M5 4h14M12 20V8m-6 6 6-6 6 6" /></svg>
      </button>
      <button
        type="button"
        data-toc-action="bottom"
        :title="t('floatingToc.bottom')"
        :aria-label="t('floatingToc.bottom')"
        @click="scrollToEdge(true)"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
        ><path d="M5 20h14M12 4v12m-6-6 6 6 6-6" /></svg>
      </button>
      <button
        type="button"
        data-toc-action="copy"
        :title="t(copied ? 'floatingToc.copied' : 'floatingToc.copy')"
        :aria-label="t('floatingToc.copy')"
        @click="copyOutline"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
        ><path d="M8 8h12v12H8zM4 16V4h12" /></svg>
      </button>
      <span
        class="toc-status"
        role="status"
      >{{ copied ? t('floatingToc.copied') : '' }}</span>
    </header>
    <div
      v-show="expanded && searchOpen"
      class="toc-search"
      @mousedown.stop
    >
      <input
        ref="searchInput"
        v-model="searchQuery"
        type="search"
        :placeholder="t('floatingToc.searchPlaceholder')"
        :aria-label="t('floatingToc.search')"
        @keydown.esc.stop.prevent="closeSearch"
        @keydown.enter.prevent="navigateFirstMatch"
      >
      <span role="status">{{ searchQuery.trim() ? `${searchMatches.size}` : '' }}</span>
    </div>
    <ol
      ref="list"
      class="toc-list"
    >
      <li
        v-for="entry in visibleEntries"
        :key="entry.slug"
        :data-toc-slug="entry.slug"
        :data-toc-level="entry.level"
        :class="{ active: entry.slug === activeSlug, ancestor: ancestors.has(entry.slug), 'search-match': searchMatches.has(entry.slug) && !visitedMatches.has(entry.slug) }"
        :style="{ '--heading-level': entry.level, '--heading-indent': `${Math.max(0, entry.level - 2) * 8}px` }"
      >
        <span
          v-show="expanded"
          class="toc-level"
          aria-hidden="true"
        >H{{ entry.level }}</span>
        <div class="toc-content">
          <button
            v-if="entry.hasChildren && expanded"
            class="toc-branch"
            type="button"
            :aria-label="`${t(effectiveCollapsed.has(entry.slug) ? 'floatingToc.expand' : 'floatingToc.collapse')}: ${entry.label}`"
            :aria-expanded="!effectiveCollapsed.has(entry.slug)"
            @click="toggleBranch(entry.slug)"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              :class="{ collapsed: effectiveCollapsed.has(entry.slug) }"
            ><path d="m4 6 4 4 4-4" /></svg>
          </button>
          <span
            v-else-if="expanded"
            class="toc-branch-space"
            aria-hidden="true"
          />
          <button
            class="toc-heading"
            type="button"
            :data-heading-index="entry.index"
            :aria-label="entry.label"
            :aria-current="entry.slug === activeSlug ? 'location' : undefined"
            :title="expanded ? undefined : entry.label"
            @click="navigate(entry.slug)"
          >
            <span
              class="toc-stroke"
              aria-hidden="true"
            />
            <span class="toc-label"><span
              v-for="(run, index) in labels.get(entry.slug)"
              :key="index"
              :style="run.color ? { color: run.color } : undefined"
            >{{ run.text }}</span></span>
          </button>
        </div>
      </li>
    </ol>
  </nav>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/store/preferences'
import { useEditorStore } from '@/store/editor'
import bus from '@/bus'
import { TOP_LEVEL_HEADINGS_SELECTOR } from '@/util/tocNavigation'
import { findMarkdownHeadingLine, getMarkdownHeadingSource } from '@/util/sourceModeToc'
import { floatingTocLabel } from '@/util/floatingTocLabel'
import { deriveFloatingToc, visibleFloatingToc, floatingTocAncestors, findFloatingTocActive, floatingTocOutline, searchFloatingToc, revealFloatingTocMatches } from '@/util/floatingToc'

const { t } = useI18n()
const preferencesStore = usePreferencesStore()
const { floatingTocPinned, sourceCode } = storeToRefs(preferencesStore)
const { listToc, currentFile } = storeToRefs(useEditorStore())
const navigation = ref<HTMLElement | null>(null)
const list = ref<HTMLElement | null>(null)
const hovered = ref(false)
const focused = ref(false)
const copied = ref(false)
const activeSlug = ref<string | null>(null)
const collapsed = ref(new Set<string>())
const searchOpen = ref(false)
const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const visitedMatches = ref(new Set<string>())
const entries = computed(() => deriveFloatingToc(listToc.value))
const labels = computed(() => new Map(entries.value.map(entry => [entry.slug, floatingTocLabel(
  getMarkdownHeadingSource(currentFile.value?.markdown ?? '', entry.index, preferencesStore), entry.label, preferencesStore
)])))
const searchMatches = computed(() => searchFloatingToc(entries.value, searchQuery.value))
const effectiveCollapsed = computed(() => revealFloatingTocMatches(entries.value, collapsed.value, searchMatches.value))
const visibleEntries = computed(() => visibleFloatingToc(entries.value, effectiveCollapsed.value))
const ancestors = computed(() => floatingTocAncestors(entries.value, activeSlug.value))
const expanded = computed(() => hovered.value || focused.value || floatingTocPinned.value)
const sourceLines = computed(() => new Map(entries.value.map(entry => [entry.index, findMarkdownHeadingLine(currentFile.value?.markdown ?? '', entry.index, preferencesStore)])))
let container: HTMLElement | null = null
let mutationObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null
let frame: number | null = null
let copyTimer: ReturnType<typeof setTimeout> | null = null
let destroyed = false
let connection = 0

const keepActiveVisible = (): void => {
  if (searchQuery.value.trim()) return
  if (!list.value) return
  const rows = Array.from(list.value.querySelectorAll<HTMLElement>('[data-toc-slug]'))
  const row = rows.find(node => node.dataset.tocSlug === activeSlug.value) ??
    [...rows].reverse().find(node => ancestors.value.has(node.dataset.tocSlug ?? ''))
  if (!row) return
  const box = list.value.getBoundingClientRect()
  const item = row.getBoundingClientRect()
  if (item.top < box.top) list.value.scrollTop += item.top - box.top
  else if (item.bottom > box.bottom) list.value.scrollTop += item.bottom - box.bottom
}

const measure = (): void => {
  frame = null
  if (!container || destroyed) return
  const headings = sourceCode.value
    ? container.querySelectorAll('.CodeMirror-code .CodeMirror-line')
    : container.querySelectorAll(TOP_LEVEL_HEADINGS_SELECTOR)
  const positions = entries.value.flatMap(entry => {
    const index = sourceCode.value ? sourceLines.value.get(entry.index) ?? -1 : entry.index
    const element = headings[index]
    return element ? [{ slug: entry.slug, top: element.getBoundingClientRect().top }] : []
  })
  activeSlug.value = findFloatingTocActive(positions, container.getBoundingClientRect().top, container.scrollTop > 0 && container.scrollTop + container.clientHeight >= container.scrollHeight - 1)
  keepActiveVisible()
}

const scheduleMeasure = (): void => {
  if (!destroyed && frame === null) frame = requestAnimationFrame(measure)
}

const disconnect = (): void => {
  container?.removeEventListener('scroll', scheduleMeasure)
  container?.removeEventListener('load', scheduleMeasure, true)
  mutationObserver?.disconnect()
  resizeObserver?.disconnect()
  mutationObserver = null
  resizeObserver = null
  container = null
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
}

const connect = async (): Promise<void> => {
  const currentConnection = ++connection
  disconnect()
  await nextTick()
  if (destroyed || connection !== currentConnection) return
  const root = navigation.value?.parentElement ?? document.querySelector('.editor-with-tabs')
  container = root?.querySelector<HTMLElement>(sourceCode.value ? '.source-code' : '.mu-editor') ?? null
  if (!container) return
  container.addEventListener('scroll', scheduleMeasure, { passive: true })
  container.addEventListener('load', scheduleMeasure, true)
  mutationObserver = new MutationObserver(scheduleMeasure)
  mutationObserver.observe(container, { childList: true, subtree: true, characterData: true })
  resizeObserver = new ResizeObserver(scheduleMeasure)
  resizeObserver.observe(container)
  const content = container.querySelector('.mu-container, .CodeMirror-code')
  if (content) resizeObserver.observe(content)
  scheduleMeasure()
}

const toggleBranch = (slug: string): void => {
  const next = new Set(collapsed.value)
  if (next.has(slug)) next.delete(slug)
  else next.add(slug)
  collapsed.value = next
  nextTick(keepActiveVisible)
}

const expandAll = (): void => {
  collapsed.value = new Set()
  nextTick(keepActiveVisible)
}
const collapseAll = (): void => {
  collapsed.value = new Set(entries.value.filter(entry => entry.hasChildren).map(entry => entry.slug))
  nextTick(keepActiveVisible)
}

const navigate = (slug: string): void => {
  visitedMatches.value = new Set([...visitedMatches.value, slug])
  bus.emit('scroll-to-header', slug)
}
const closeSearch = (): void => { searchQuery.value = ''; searchOpen.value = false }
const toggleSearch = async (): Promise<void> => {
  if (searchOpen.value) { closeSearch(); return }
  searchOpen.value = true
  await nextTick()
  searchInput.value?.focus({ preventScroll: true })
}
const navigateFirstMatch = (): void => {
  const slug = [...searchMatches.value].find(slug => !visitedMatches.value.has(slug)) ?? [...searchMatches.value][0]
  if (slug) navigate(slug)
}
watch(searchQuery, async () => {
  visitedMatches.value = new Set()
  await nextTick()
  const row = list.value && [...list.value.querySelectorAll<HTMLElement>('[data-toc-slug]')].find(node => searchMatches.value.has(node.dataset.tocSlug ?? ''))
  if (row && list.value) list.value.scrollTop += row.getBoundingClientRect().top - list.value.getBoundingClientRect().top
})
const togglePin = (): void => {
  preferencesStore.SET_SINGLE_PREFERENCE({ type: 'floatingTocPinned', value: !floatingTocPinned.value })
}
const scrollToEdge = (bottom: boolean): void => {
  container?.scrollTo({ top: bottom ? container.scrollHeight : 0, behavior: 'smooth' })
}
const copyOutline = (): void => {
  window.electron.clipboard.writeText(floatingTocOutline(entries.value))
  copied.value = true
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copied.value = false }, 1500)
}
const handleFocusOut = (event: FocusEvent): void => {
  focused.value = event.relatedTarget instanceof Node && !!navigation.value?.contains(event.relatedTarget)
}

watch([sourceCode, () => currentFile.value?.id], () => {
  closeSearch()
  visitedMatches.value = new Set()
  collapsed.value = new Set()
  activeSlug.value = null
  hovered.value = false
  focused.value = false
  connect()
})
watch(entries, async () => {
  const known = new Set(entries.value.map(entry => entry.slug))
  collapsed.value = new Set([...collapsed.value].filter(slug => known.has(slug)))
  await nextTick()
  if (!container) connect()
  else scheduleMeasure()
})
watch(expanded, () => nextTick(keepActiveVisible))
onMounted(connect)
onBeforeUnmount(() => {
  destroyed = true
  disconnect()
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<style scoped>
.floating-toc {
  position: absolute;
  z-index: 20;
  top: 140px;
  right: 20px;
  display: flex;
  flex-direction: column;
  width: 32px;
  max-width: calc(100% - 40px);
  max-height: calc(100% - 180px);
  padding: 5px 0;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--editorColor);
  font-size: 13px;
}
.floating-toc button { font: inherit; }
.floating-toc.expanded { width: 352px; padding: 0; overflow: hidden; background: var(--editorBgColor); border-color: var(--editorColor10); box-shadow: 0 4px 20px var(--editorColor10); }
.toc-tools { display: flex; align-items: center; flex: 0 0 32px; padding: 0 6px; border-bottom: 1px solid var(--editorColor10); }
.toc-caption { flex: 1; padding-left: 4px; font-weight: 600; white-space: nowrap; }
.toc-tools button { display: flex; align-items: center; justify-content: center; width: 28px; height: 26px; padding: 4px; border: 0; border-radius: 4px; color: inherit; background: transparent; cursor: pointer; }
.toc-tools button[aria-pressed="true"], .toc-tools button:hover { color: var(--themeColor); background: var(--editorColor04); }
.toc-tools svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.toc-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.toc-search { display: flex; gap: 6px; align-items: center; padding: 6px 10px; }
.toc-search input { min-width: 0; flex: 1; padding: 5px 7px; border: 1px solid var(--editorColor20); border-radius: 4px; background: var(--editorColor04); color: var(--editorColor); font: inherit; }
.toc-search span { color: var(--editorColor60); font-size: 11px; }
.toc-list { position: relative; flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; margin: 0; padding: 3px 0; list-style: none; scrollbar-width: none; }
.toc-list::-webkit-scrollbar { display: none; width: 0; height: 0; }
.toc-list li { position: relative; display: flex; align-items: center; margin: 0; padding: 0; }
.toc-content { display: flex; flex: 1; min-width: 0; }
.toc-heading { display: flex; align-items: center; width: 100%; min-height: 15px; padding: 3px 4px; border: 0; border-radius: 4px; background: transparent; color: var(--editorColor40); cursor: pointer; text-align: start; }
.toc-stroke { flex: 0 0 auto; width: calc(22px - (var(--heading-level) - 1) * 2px); height: 2px; margin-left: calc((var(--heading-level) - 1) * 2px); border-radius: 2px; background: currentColor; }
.toc-label, .toc-level { display: none; }
.active .toc-heading { color: var(--themeColor); }
.ancestor .toc-heading { color: var(--editorColor80); }
.toc-heading:hover { color: var(--themeColor); }
.expanded .toc-list { padding: 4px 0; }
.expanded .toc-list li { align-items: flex-start; gap: 3px; margin: 0; padding: 6px 12px; border-radius: 0; }
.expanded .toc-content { align-items: flex-start; gap: 2px; padding-left: var(--heading-indent); }
.expanded .toc-heading { flex: 1; min-width: 0; min-height: 21px; padding: 0; color: var(--editorColor); border-radius: 2px; font-size: 13px; text-align: left; }
.expanded .toc-stroke { display: none; }
.expanded .toc-label { display: block; min-width: 0; white-space: normal; overflow-wrap: anywhere; line-height: 1.55; text-align: left; }
.expanded .toc-level { display: block; flex: 0 0 20px; padding-top: 1px; color: var(--editorColor60); font-size: 10px; line-height: 1.95; font-weight: 400; text-align: left; }
.expanded [data-toc-level="1"] { margin-bottom: 7px; padding-bottom: 10px; border-bottom: 1px solid var(--editorColor10); }
.expanded [data-toc-level="1"] .toc-heading { color: var(--themeColor); font-size: 16px; font-weight: 650; }
.expanded [data-toc-level="2"] .toc-heading { font-size: 14px; font-weight: 550; }
.expanded .active { background-image: linear-gradient(var(--themeColor10), var(--themeColor10)); }
.expanded .active .toc-heading { color: var(--themeColor); }
.expanded .active::before { position: absolute; top: 5px; bottom: 5px; left: 0; width: 3px; border-radius: 2px; background: var(--themeColor); content: ''; }
.expanded .toc-list li:hover { background-image: linear-gradient(var(--editorColor04), var(--editorColor04)); }
.expanded .search-match { background-image: linear-gradient(#ce791f66, #ce791f66); }
.expanded .search-match .toc-heading { color: #ffb957; }
.expanded .search-match .toc-level { color: #ffb957; }
.toc-branch, .toc-branch-space { flex: 0 0 14px; width: 14px; height: 21px; }
.toc-branch { display: flex; align-items: center; justify-content: center; padding: 0; border: 0; color: var(--editorColor60); background: transparent; cursor: pointer; }
.toc-branch svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.toc-branch .collapsed { transform: rotate(-90deg); }
.floating-toc button:focus-visible { outline: 2px solid var(--themeColor); outline-offset: -2px; }
</style>
