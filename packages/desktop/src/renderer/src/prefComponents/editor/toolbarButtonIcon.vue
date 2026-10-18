<template>
  <span
    v-if="id === 'heading-n'"
    class="heading-icon"
    aria-hidden="true"
  >H<sub>n</sub></span>
  <span
    v-else-if="asset"
    class="asset-icon"
    :style="{ maskImage: `url(${JSON.stringify(asset)})` }"
    aria-hidden="true"
  />
  <svg
    v-else
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path
      v-for="(d, index) in paths"
      :key="index"
      :d="d"
      :stroke="id === 'mark' && index === 2 ? '#fff18c' : undefined"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ToolbarButton } from 'common/toolbar'
import glyphPaths from '../../../../../../muya/src/ui/inlineFormatToolbar/glyphPaths.json'
import codeblockIcon from '@muyajs/core/ui/inlineFormatToolbar/icons/codeblock.svg?url'
import tableIcon from '@muyajs/core/ui/inlineFormatToolbar/icons/table.svg?url'
import mathblockIcon from '@muyajs/core/ui/inlineFormatToolbar/icons/mathblock.svg?url'
import textColorIcon from '@muyajs/core/ui/inlineFormatToolbar/icons/font-color.svg?url'
import backgroundColorIcon from '@muyajs/core/ui/inlineFormatToolbar/icons/background-color.svg?url'

const props = defineProps<{ id: ToolbarButton }>()
const assets: Partial<Record<ToolbarButton, string>> = {
  codeblock: codeblockIcon,
  table: tableIcon,
  mathblock: mathblockIcon,
  'text-color': textColorIcon,
  'background-color': backgroundColorIcon
}
const asset = computed(() => assets[props.id])
const paths = computed(() => (glyphPaths as Record<string, string[]>)[props.id.replace(/^align-/, '')] ?? [])
</script>

<style scoped>
svg, .asset-icon { width: 24px; height: 24px; pointer-events: none; flex-shrink: 0; }
.asset-icon { display: block; background: currentColor; mask-size: contain; mask-repeat: no-repeat; mask-position: center; }
.heading-icon { font-size: 20px; line-height: 1; pointer-events: none; }
.heading-icon sub { font-size: 12px; }
</style>
