<template>
  <div class="display-settings">
    <fieldset
      v-for="group in groups"
      :key="group.name"
    >
      <legend>{{ t(`preferences.theme.display.${group.name}`) }}</legend>
      <label class="display-range">
        <span>
          {{ t('preferences.theme.display.brightness') }}
          <span
            class="display-value"
            aria-hidden="true"
          >{{ preferences[group.brightness] }}%</span>
        </span>
        <input
          type="range"
          :min="group.minBrightness"
          max="100"
          step="5"
          :value="preferences[group.brightness]"
          :aria-valuetext="`${preferences[group.brightness]}%`"
          @input="setRange(group.brightness, $event)"
        >
      </label>
      <div class="display-switch">
        <label :for="`display-${group.name}-eye-comfort`">
          {{ t('preferences.theme.display.eyeComfort') }}
        </label>
        <el-switch
          :id="`display-${group.name}-eye-comfort`"
          :model-value="preferences[group.eyeComfort]"
          @update:model-value="
            (value: boolean | string | number) =>
              preferences.SET_SINGLE_PREFERENCE({ type: group.eyeComfort, value: Boolean(value) })
          "
        />
      </div>
      <label class="display-range">
        <span>
          {{ t('preferences.theme.display.warmth') }}
          <span
            class="display-value"
            aria-hidden="true"
          >{{ preferences[group.warmth] }}%</span>
        </span>
        <input
          type="range"
          min="0"
          max="100"
          :value="preferences[group.warmth]"
          :aria-valuetext="`${preferences[group.warmth]}%`"
          :disabled="!preferences[group.eyeComfort]"
          @input="setRange(group.warmth, $event)"
        >
      </label>
    </fieldset>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePreferencesStore, type PreferencesState } from '@/store/preferences'

const { t } = useI18n()
const preferences = usePreferencesStore()
const groups = [
  {
    name: 'window',
    brightness: 'windowBrightness',
    eyeComfort: 'windowEyeComfort',
    warmth: 'windowWarmth',
    minBrightness: 50
  },
  {
    name: 'image',
    brightness: 'imageBrightness',
    eyeComfort: 'imageEyeComfort',
    warmth: 'imageWarmth',
    minBrightness: 40
  }
] as const

const setRange = (type: keyof PreferencesState, event: Event) => {
  const value = (event.currentTarget as HTMLInputElement).valueAsNumber
  preferences.SET_SINGLE_PREFERENCE({ type, value })
}
</script>

<style scoped>
.display-settings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 12px;
  margin: 16px 0 20px;
  color: var(--editorColor);
  font-size: 14px;
}
.display-settings fieldset {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  margin: 0;
  padding: 8px 14px 14px;
  border: 1px solid var(--editorColor10);
  border-radius: 6px;
}
.display-settings legend {
  padding: 0 5px;
  font-weight: 600;
}
.display-range {
  display: grid;
  gap: 6px;
}
.display-range > span,
.display-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.display-value {
  font-variant-numeric: tabular-nums;
}
.display-range input {
  width: 100%;
  margin: 0;
  accent-color: var(--themeColor);
}
.display-range:has(input:disabled) {
  opacity: 0.55;
}
</style>
