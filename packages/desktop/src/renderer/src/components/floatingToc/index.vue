<template>
  <nav
    v-if="entries.length"
    ref="navigation"
    class="floating-toc"
    data-testid="floating-toc"
    :class="{ expanded, pinned: floatingTocPinned }"
    :style="{ '--expanded-min-height': `${expandedMinHeight}px` }"
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
      v-if="!expanded"
      key="compact"
      ref="compactList"
      class="toc-list toc-rail"
      :style="{ '--compact-row-height': `${COMPACT_ROW_HEIGHT}px`, '--compact-padding': `${COMPACT_LIST_PADDING}px` }"
    >
      <li
        v-for="entry in entries"
        :key="entry.slug"
        v-memo="[entry.slug, entry.label, entry.level, entry.slug === activeSlug, entry.slug === parentSlug, entry.slug === grandparentSlug]"
        :data-toc-slug="entry.slug"
        :data-toc-level="entry.level"
        :class="{ active: entry.slug === activeSlug, 'parent-heading': entry.slug === parentSlug, 'grandparent-heading': entry.slug === grandparentSlug }"
        :style="{ '--heading-level': entry.level }"
      >
        <button
          class="toc-heading"
          type="button"
          :data-heading-index="entry.index"
          :aria-label="entry.label"
          :aria-current="entry.slug === activeSlug ? 'location' : undefined"
          :title="entry.label"
          @click="navigate(entry.slug)"
        >
          <span
            class="toc-stroke"
            aria-hidden="true"
          />
          <span class="toc-label">{{ entry.label }}</span>
        </button>
      </li>
    </ol>
    <ol
      v-else
      key="expanded"
      ref="list"
      class="toc-list"
    >
      <li
        v-for="entry in visibleEntries"
        :key="entry.slug"
        :ref="element => setRowRef(entry.slug, element)"
        v-memo="[expanded, entry.slug, entry.label, entry.level, entry.hasChildren, effectiveCollapsed.has(entry.slug), entry.slug === activeSlug, ancestors.has(entry.slug), entry.slug === parentSlug, entry.slug === grandparentSlug, searchMatches.has(entry.slug) && !visitedMatches.has(entry.slug), labels.get(entry.slug)]"
        :data-toc-slug="entry.slug"
        :data-toc-level="entry.level"
        :class="{ active: entry.slug === activeSlug, ancestor: ancestors.has(entry.slug), 'parent-heading': entry.slug === parentSlug, 'grandparent-heading': entry.slug === grandparentSlug, 'search-match': searchMatches.has(entry.slug) && !visitedMatches.has(entry.slug) }"
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
import { deriveFloatingToc, visibleFloatingToc, floatingTocAncestors, findFloatingTocActiveAtScroll, floatingTocOutline, searchFloatingToc, revealFloatingTocMatches } from '@/util/floatingToc'

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
const entriesBySlug = computed(() => new Map(entries.value.map(entry => [entry.slug, entry])))
const parentSlug = computed(() => activeSlug.value ? entriesBySlug.value.get(activeSlug.value)?.parentSlug ?? null : null)
const grandparentSlug = computed(() => parentSlug.value ? entriesBySlug.value.get(parentSlug.value)?.parentSlug ?? null : null)
const searchMatches = computed(() => searchFloatingToc(entries.value, searchQuery.value))
const effectiveCollapsed = computed(() => revealFloatingTocMatches(entries.value, collapsed.value, searchMatches.value))
const visibleEntries = computed(() => visibleFloatingToc(entries.value, effectiveCollapsed.value))
const ancestors = computed(() => floatingTocAncestors(entries.value, activeSlug.value, entriesBySlug.value))
const expanded = computed(() => hovered.value || focused.value || floatingTocPinned.value)
const compactRowIndexes = computed(() => new Map(entries.value.map((entry, index) => [entry.slug, index])))
const sourceLines = computed(() => new Map(entries.value.map(entry => [entry.index, findMarkdownHeadingLine(currentFile.value?.markdown ?? '', entry.index, preferencesStore)])))
const compactList = ref<HTMLOListElement | null>(null)
const expandedMinHeight = ref(0)
let container: HTMLElement | null = null
let mutationObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null
let frame: number | null = null
let activeFrame: number | null = null
let copyTimer: ReturnType<typeof setTimeout> | null = null
let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null
let destroyed = false
let connection = 0
let scrolling = false
let measurePending = false
let headingPositions: Array<{ slug: string; top: number }> = []
let compactListScrollTop = 0
const rowRefs = new Map<string, HTMLElement>()

const SCROLL_IDLE_MS = 200
const COMPACT_ROW_HEIGHT = 15
const COMPACT_LIST_PADDING = 3

const setRowRef = (slug: string, element: unknown): void => {
  if (element instanceof HTMLElement) rowRefs.set(slug, element)
  else rowRefs.delete(slug)
}

const keepActiveVisible = (): void => {
  if (!expanded.value) {
    const rail = compactList.value
    const index = activeSlug.value ? compactRowIndexes.value.get(activeSlug.value) : undefined
    if (!rail || index === undefined) return
    // Compact rows have fixed geometry and their own scroll position. Opening
    // the variable-height labels must not move the reading-position marker.
    const top = index * COMPACT_ROW_HEIGHT
    const bottom = top + COMPACT_ROW_HEIGHT + COMPACT_LIST_PADDING * 2
    const height = rail.clientHeight
    if (top < compactListScrollTop) compactListScrollTop = top
    else if (bottom > compactListScrollTop + height) compactListScrollTop = bottom - height
    rail.scrollTop = compactListScrollTop
    compactListScrollTop = rail.scrollTop
    return
  }
  if (searchQuery.value.trim()) return
  if (!list.value) return
  const row = (activeSlug.value ? rowRefs.get(activeSlug.value) : undefined) ??
    [...ancestors.value].map(slug => rowRefs.get(slug)).find((node): node is HTMLElement => !!node)
  if (!row) return
  const box = list.value.getBoundingClientRect()
  const item = row.getBoundingClientRect()
  if (item.top < box.top) list.value.scrollTop += item.top - box.top
  else if (item.bottom > box.bottom) list.value.scrollTop += item.bottom - box.bottom
}

const updateActive = (): void => {
  activeFrame = null
  if (!container || destroyed) return
  const nextSlug = findFloatingTocActiveAtScroll(
    headingPositions,
    container.scrollTop,
    container.scrollTop > 0 && container.scrollTop + container.clientHeight >= container.scrollHeight - 1
  )
  if (nextSlug === activeSlug.value) return
  activeSlug.value = nextSlug
  nextTick(keepActiveVisible)
}

const measure = (): void => {
  frame = null
  if (!container || destroyed) return
  const headings = sourceCode.value
    ? container.querySelectorAll('.CodeMirror-code .CodeMirror-line')
    : container.querySelectorAll(TOP_LEVEL_HEADINGS_SELECTOR)
  // Store document-relative positions once per layout change. Scroll updates
  // then need only the container's scrollTop and do not force a full layout.
  const containerTop = container.getBoundingClientRect().top
  const scrollTop = container.scrollTop
  headingPositions = entries.value.flatMap(entry => {
    const index = sourceCode.value ? sourceLines.value.get(entry.index) ?? -1 : entry.index
    const element = headings[index]
    return element ? [{ slug: entry.slug, top: element.getBoundingClientRect().top - containerTop + scrollTop }] : []
  })
  updateActive()
  keepActiveVisible()
}

const scheduleMeasure = (): void => {
  if (destroyed) return
  if (scrolling) {
    measurePending = true
    return
  }
  measurePending = false
  if (activeFrame !== null) {
    cancelAnimationFrame(activeFrame)
    activeFrame = null
  }
  if (frame === null) frame = requestAnimationFrame(measure)
}

const scheduleActive = (): void => {
  if (destroyed || frame !== null || activeFrame !== null) return
  activeFrame = requestAnimationFrame(updateActive)
}

const handleScroll = (): void => {
  scrolling = true
  if (frame !== null) {
    cancelAnimationFrame(frame)
    frame = null
    measurePending = true
  }
  if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer)
  scrollIdleTimer = setTimeout(() => {
    scrollIdleTimer = null
    scrolling = false
    if (measurePending) scheduleMeasure()
  }, SCROLL_IDLE_MS)
  scheduleActive()
}

const handleResourceLoad = (event: Event): void => {
  if (event.target instanceof HTMLImageElement) scheduleMeasure()
}

const disconnect = (): void => {
  container?.removeEventListener('scroll', handleScroll)
  container?.removeEventListener('load', handleResourceLoad, true)
  window.removeEventListener('resize', scheduleMeasure)
  mutationObserver?.disconnect()
  resizeObserver?.disconnect()
  mutationObserver = null
  resizeObserver = null
  container = null
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
  if (activeFrame !== null) cancelAnimationFrame(activeFrame)
  activeFrame = null
  if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer)
  scrollIdleTimer = null
  scrolling = false
  measurePending = false
  headingPositions = []
}

const connect = async (): Promise<void> => {
  const currentConnection = ++connection
  disconnect()
  await nextTick()
  if (destroyed || connection !== currentConnection) return
  const root = navigation.value?.parentElement ?? document.querySelector('.editor-with-tabs')
  container = root?.querySelector<HTMLElement>(sourceCode.value ? '.source-code' : '.mu-editor') ?? null
  if (!container) return
  container.addEventListener('scroll', handleScroll, { passive: true })
  container.addEventListener('load', handleResourceLoad, true)
  mutationObserver = new MutationObserver(scheduleMeasure)
  const content = container.querySelector('.mu-container, .CodeMirror-code')
  if (content) mutationObserver.observe(content, { childList: true, subtree: true })
  resizeObserver = new ResizeObserver(scheduleMeasure)
  if (content) resizeObserver.observe(content)
  window.addEventListener('resize', scheduleMeasure, { passive: true })
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
  const row = [...searchMatches.value].map(slug => rowRefs.get(slug)).find((node): node is HTMLElement => !!node)
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
  compactListScrollTop = 0
  expandedMinHeight.value = 0
  connect()
})
watch(entries, async () => {
  const known = new Set(entries.value.map(entry => entry.slug))
  collapsed.value = new Set([...collapsed.value].filter(slug => known.has(slug)))
  for (const slug of rowRefs.keys()) if (!known.has(slug)) rowRefs.delete(slug)
  await nextTick()
  if (!container) connect()
  else scheduleMeasure()
})
watch(() => currentFile.value?.markdown, () => nextTick(scheduleMeasure))
watch(expanded, (isExpanded) => {
  if (isExpanded) {
    compactListScrollTop = compactList.value?.scrollTop ?? compactListScrollTop
    // Folded labels may be shorter than the rail. Retain its hover area so
    // expansion cannot leave the pointer outside and immediately collapse.
    expandedMinHeight.value = navigation.value?.offsetHeight ?? 0
  }
  nextTick(keepActiveVisible)
})
onMounted(connect)
onBeforeUnmount(() => {
  destroyed = true
  disconnect()
  rowRefs.clear()
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<style scoped>
.floating-toc {
  --toc-parent-color: #237c60;
  --toc-grandparent-color: #946200;
  --toc-h1-color: #1469b5;
  --toc-h2-color: #087b89;
  --toc-h3-color: #4f7b48;
  --toc-h4-color: #896500;
  --toc-h5-color: #a94f12;
  --toc-h6-color: #b32e36;
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
:global(body.dark .floating-toc) { --toc-parent-color: #65c6a3; --toc-grandparent-color: #e8b45a; --toc-h1-color: #72b7ff; --toc-h2-color: #75cbd7; --toc-h3-color: #a4cf9a; --toc-h4-color: #e2ca80; --toc-h5-color: #eeaa76; --toc-h6-color: #ed8988; }
.floating-toc button { font: inherit; }
.floating-toc.expanded { width: 352px; min-height: min(var(--expanded-min-height), calc(100% - 180px)); padding: 0; overflow: hidden; background: var(--editorBgColor); border-color: var(--editorColor10); box-shadow: 0 4px 20px var(--editorColor10); }
.toc-tools { display: flex; align-items: center; flex: 0 0 32px; padding: 0 6px; border-bottom: 1px solid var(--editorColor10); }
.toc-caption { flex: 1; padding-left: 4px; font-weight: 600; white-space: nowrap; }
.toc-tools button { display: flex; align-items: center; justify-content: center; width: 28px; height: 26px; padding: 4px; border: 0; border-radius: 4px; color: inherit; background: transparent; cursor: pointer; }
.toc-tools button[aria-pressed="true"], .toc-tools button:hover { color: var(--themeColor); background: var(--editorColor04); }
.toc-tools svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.toc-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.toc-search { display: flex; gap: 6px; align-items: center; padding: 6px 10px; }
.toc-search input { min-width: 0; flex: 1; padding: 5px 7px; border: 1px solid var(--editorColor20); border-radius: 4px; background: var(--editorColor04); color: var(--editorColor); font: inherit; }
.toc-search span { color: var(--editorColor60); font-size: 11px; }
.toc-list { position: relative; flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; overflow-anchor: none; overscroll-behavior: contain; margin: 0; padding: 3px 0; list-style: none; scrollbar-width: none; }
.toc-list::-webkit-scrollbar { display: none; width: 0; height: 0; }
.toc-list li { position: relative; display: flex; align-items: center; margin: 0; padding: 0; }
.toc-rail { padding: var(--compact-padding) 0; }
.toc-rail li, .toc-rail .toc-heading { box-sizing: border-box; height: var(--compact-row-height); min-height: 0; flex-shrink: 0; }
.toc-content { display: flex; flex: 1; min-width: 0; }
.toc-heading { display: flex; align-items: center; width: 100%; min-height: 15px; padding: 3px 4px; border: 0; border-radius: 4px; background: transparent; color: var(--editorColor40); cursor: pointer; text-align: start; }
.toc-stroke { flex: 0 0 auto; width: calc(22px - (var(--heading-level) - 1) * 2px); height: 2px; margin-left: calc((var(--heading-level) - 1) * 2px); border-radius: 2px; background: currentColor; }
.toc-label, .toc-level { display: none; }
.active .toc-heading { color: var(--themeColor); }
.toc-rail .parent-heading .toc-heading { color: var(--toc-parent-color); }
.toc-rail .grandparent-heading .toc-heading { color: var(--toc-grandparent-color); }
.toc-heading:hover { color: var(--themeColor); }
.expanded .toc-list { padding: 4px 0; }
.expanded .toc-list li { align-items: flex-start; gap: 3px; margin: 0; padding: 6px 12px; border-radius: 0; }
.expanded .toc-content { align-items: flex-start; gap: 2px; padding-left: var(--heading-indent); }
.expanded .toc-heading { flex: 1; min-width: 0; min-height: 21px; padding: 0; color: var(--editorColor); border-radius: 2px; font-size: 13px; text-align: left; }
.expanded .toc-stroke { display: none; }
.expanded .toc-label { display: block; min-width: 0; white-space: normal; overflow-wrap: anywhere; line-height: 1.55; text-align: left; }
.expanded .toc-level { display: block; flex: 0 0 20px; padding-top: 1px; color: var(--editorColor60); font-size: 10px; line-height: 1.95; font-weight: 600; text-align: left; }
.expanded [data-toc-level="1"] { margin-bottom: 7px; padding-bottom: 10px; border-bottom: 1px solid var(--editorColor10); }
.expanded [data-toc-level="1"] .toc-heading { color: var(--h1-color, var(--editorColor80)); font-size: 16px; font-weight: 650; }
.expanded [data-toc-level="2"] .toc-heading { font-size: 14px; font-weight: 550; }
.expanded [data-toc-level="2"] .toc-heading { color: var(--h2-color, var(--editorColor80)); }
.expanded [data-toc-level="3"] .toc-heading { color: var(--h3-color, var(--editorColor80)); }
.expanded [data-toc-level="4"] .toc-heading { color: var(--h4-color, var(--editorColor80)); }
.expanded [data-toc-level="5"] .toc-heading { color: var(--h5-color, var(--editorColor80)); }
.expanded [data-toc-level="6"] .toc-heading { color: var(--h6-color, var(--editorColor80)); }
.expanded [data-toc-level="1"] .toc-level { color: var(--toc-h1-color); }
.expanded [data-toc-level="2"] .toc-level { color: var(--toc-h2-color); }
.expanded [data-toc-level="3"] .toc-level { color: var(--toc-h3-color); }
.expanded [data-toc-level="4"] .toc-level { color: var(--toc-h4-color); }
.expanded [data-toc-level="5"] .toc-level { color: var(--toc-h5-color); }
.expanded [data-toc-level="6"] .toc-level { color: var(--toc-h6-color); }
.expanded .active { background-image: linear-gradient(var(--editorColor10), var(--editorColor10)); }
.expanded .toc-list li:hover { background-image: linear-gradient(var(--editorColor04), var(--editorColor04)); }
.expanded .toc-list li.active:hover { background-image: linear-gradient(var(--editorColor10), var(--editorColor10)); }
.expanded .search-match { background-image: linear-gradient(#ce791f66, #ce791f66); }
.expanded .search-match.active { background-image: linear-gradient(var(--editorColor10), var(--editorColor10)); }
.toc-branch, .toc-branch-space { flex: 0 0 14px; width: 14px; height: 21px; }
.toc-branch { display: flex; align-items: center; justify-content: center; padding: 0; border: 0; color: var(--editorColor60); background: transparent; cursor: pointer; }
.toc-branch svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.toc-branch .collapsed { transform: rotate(-90deg); }
.floating-toc button:focus-visible { outline: 2px solid var(--themeColor); outline-offset: -2px; }
</style>
