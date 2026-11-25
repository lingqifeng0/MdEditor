<template>
  <teleport to="body">
    <div
      v-if="dimOpacity > 0"
      class="editor-window-dim"
      :style="{ opacity: dimOpacity }"
      aria-hidden="true"
    />
    <svg
      v-if="imageWarmth > 0"
      class="editor-image-filter"
      aria-hidden="true"
      width="0"
      height="0"
    >
      <defs>
        <filter
          id="mdeditor-image-warmth"
          color-interpolation-filters="sRGB"
          x="0"
          y="0"
          width="1"
          height="1"
        >
          <feColorMatrix
            type="matrix"
            :values="imageMatrix"
          />
        </filter>
      </defs>
    </svg>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch, watchEffect } from 'vue'
import { usePreferencesStore } from '@/store/preferences'

const preferences = usePreferencesStore()
const root = document.documentElement
const dimOpacity = computed(() => (100 - preferences.windowBrightness) / 100)
const windowWarmth = computed(() => preferences.windowEyeComfort ? preferences.windowWarmth : 0)
const imageWarmth = computed(() => preferences.imageEyeComfort ? preferences.imageWarmth : 0)
const imageBrightness = computed(() => preferences.imageBrightness / 100)

const green = (warmth: number) => Math.round(255 - 0.36 * warmth) / 255
const blue = (warmth: number) => Math.round(255 - 1.2 * warmth) / 255

const imageMatrix = computed(() => {
  const brightness = imageBrightness.value
  const warmth = imageWarmth.value
  return `${brightness} 0 0 0 0
    0 ${brightness * green(warmth)} 0 0 0
    0 0 ${brightness * blue(warmth)} 0 0
    0 0 0 1 0`
})

watchEffect(() => {
  const hasFilter = imageWarmth.value > 0 || imageBrightness.value !== 1
  root.toggleAttribute('data-mdeditor-image-filter', hasFilter)
  if (hasFilter) {
    const filter = imageWarmth.value > 0
      ? 'url(#mdeditor-image-warmth)'
      : `brightness(${imageBrightness.value})`
    root.style.setProperty('--mdeditor-image-filter', filter)
  } else {
    root.style.removeProperty('--mdeditor-image-filter')
  }
})

watchEffect(() => {
  root.style.setProperty('--mdeditor-warm-green', String(green(windowWarmth.value)))
  root.style.setProperty('--mdeditor-warm-blue', String(blue(windowWarmth.value)))
})

let warmedTheme: HTMLStyleElement | undefined

// Warm the theme palette so images can retain their own colors without filtering
// the scrolling editor or changing how its descendants are positioned.
watch(
  [() => windowWarmth.value > 0, () => preferences.theme, () => preferences.customCss],
  ([enabled]) => {
    warmedTheme?.remove()
    warmedTheme = undefined
    if (!enabled) return

    const computedTheme = getComputedStyle(root)
    const declarations: string[] = []
    for (const name of computedTheme) {
      if (!name.startsWith('--')) continue
      const color = computedTheme.getPropertyValue(name).trim()
      if (color.toLowerCase() === 'currentcolor' || !CSS.supports('color', color)) continue
      declarations.push(
        `${CSS.escape(name)}: rgb(from ${color} r calc(g * var(--mdeditor-warm-green)) ` +
        'calc(b * var(--mdeditor-warm-blue)) / alpha)'
      )
    }
    warmedTheme = document.createElement('style')
    warmedTheme.textContent = `@media screen { :root { ${declarations.join(';')} } }`
    document.head.append(warmedTheme)
  },
  { immediate: true, flush: 'post' }
)

onBeforeUnmount(() => {
  warmedTheme?.remove()
  root.removeAttribute('data-mdeditor-image-filter')
  root.style.removeProperty('--mdeditor-image-filter')
  root.style.removeProperty('--mdeditor-warm-green')
  root.style.removeProperty('--mdeditor-warm-blue')
})
</script>

<style>
.editor-window-dim,
.editor-image-filter {
  position: fixed;
  pointer-events: none;
}
.editor-window-dim {
  inset: 0;
  z-index: 2147483647;
  background: #000;
}
@media print {
  .editor-window-dim {
    display: none;
  }
}
@media screen {
  :root[data-mdeditor-image-filter] .editor-component img,
  :root[data-mdeditor-image-filter] .html-layout-stage img,
  :root[data-mdeditor-image-filter] .media-viewer-stage > img {
    filter: var(--mdeditor-image-filter);
  }
}
</style>
