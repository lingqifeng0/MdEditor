import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { compileScript, parse } from 'vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import * as widthHelpers from '@/util/editorWidth'
import type { EditorWidthValue } from '@/util/editorWidth'

interface SetupModule<T> {
  default: { setup: (props: unknown, context: { expose: () => void }) => T }
}

// The unit runner has no Vue SFC plugin. Compile the real setup code and
// supply its boundary dependencies while retaining Vue's reactive behavior.
const loadSetup = <T>(relativePath: string, dependencies: Record<string, unknown>): SetupModule<T>['default'] => {
  const here = dirname(fileURLToPath(import.meta.url))
  const filename = resolve(here, '../../../src/renderer/src', relativePath)
  const source = readFileSync(filename, 'utf8')
  const { descriptor } = parse(source, { filename })
  const compiled = compileScript(descriptor, {
    id: 'width-control-test',
    fs: { fileExists: existsSync, readFile: (path) => readFileSync(path, 'utf8') }
  })
  const script = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  // eslint-disable-next-line no-new-func
  const factory = new Function('require', 'exports', 'module', `${script}\nreturn module.exports`) as (
    require: (id: string) => unknown,
    exports: object,
    module: object
  ) => SetupModule<T>
  const module = { exports: {} }
  return factory((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected component dependency: ${id}`)
    return dependencies[id]
  }, module.exports, module).default
}

const scopes: Vue.EffectScope[] = []

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.useRealTimers()
})

interface WidthBindings {
  draft: Vue.Ref<EditorWidthValue>
  valueText: Vue.Ref<string>
  previewSlider: (event: Event) => void
  commitSlider: (event: Event) => void
  previewNumber: (event: Event) => void
  commitNumber: () => void
  resetWidth: () => void
  cancelPreview: () => void
}

const valueEvent = (value: string): Event => ({ target: { value } }) as unknown as Event

const bootWidthControl = (savedWidth = '') => {
  const state = Vue.reactive({ editorLineWidth: savedWidth })
  const save = vi.fn(({ value }: { type: string; value: string }) => {
    state.editorLineWidth = value
  })
  const preview = vi.fn()
  let cleanup: (() => void) | undefined
  const scope = Vue.effectScope()
  scopes.push(scope)
  const component = loadSetup<WidthBindings>('components/editorWidthControl/index.vue', {
    vue: {
      ...Vue,
      useId: () => 'width-control',
      onBeforeUnmount: (callback: () => void) => { cleanup = callback }
    },
    pinia: { storeToRefs: () => ({ editorLineWidth: Vue.toRef(state, 'editorLineWidth') }) },
    'vue-i18n': { useI18n: () => ({ t: (key: string) => key }) },
    '@/store/preferences': {
      usePreferencesStore: () => ({
        get editorLineWidth() { return state.editorLineWidth },
        SET_SINGLE_PREFERENCE: save
      })
    },
    '@/util/theme': { setEditorWidth: preview },
    '@/util/editorWidth': widthHelpers
  })
  const bindings = scope.run(() => component.setup({ compact: true }, { expose: () => {} }))
  if (!bindings) throw new Error('Width control did not initialize')
  return { bindings, state, save, preview, unmount: () => cleanup?.() }
}

describe('text width control', () => {
  it('previews dragging in the current window and saves only the final change', async() => {
    const { bindings, state, save, preview } = bootWidthControl('800px')

    bindings.previewSlider(valueEvent('1100'))
    bindings.previewSlider(valueEvent('1200'))
    expect(preview).toHaveBeenLastCalledWith('1200px')
    expect(state.editorLineWidth).toBe('800px')
    expect(save).not.toHaveBeenCalled()

    bindings.commitSlider(valueEvent('1200'))
    await Vue.nextTick()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ type: 'editorLineWidth', value: '1200px' })
    expect(state.editorLineWidth).toBe('1200px')
  })

  it.each(['80ch', '60%', '2500px', '791px'])(
    'opens a saved width %s without rewriting the preference', (savedWidth) => {
      const { bindings, state, save, preview } = bootWidthControl(savedWidth)
      expect(bindings.draft.value).toEqual(widthHelpers.parseEditorWidth(savedWidth))
      expect(state.editorLineWidth).toBe(savedWidth)
      expect(save).not.toHaveBeenCalled()
      expect(preview).not.toHaveBeenCalled()
    }
  )

  it('keeps precise number edits rather than rounding them to the slider step', () => {
    const { bindings, state, save } = bootWidthControl()
    bindings.previewNumber(valueEvent('957'))
    expect(save).not.toHaveBeenCalled()
    bindings.commitNumber()
    expect(state.editorLineWidth).toBe('957px')
    expect(bindings.valueText.value).toBe('957')
  })

  it('reset stores the default sentinel and shows its 1000px value', () => {
    const { bindings, state, preview, save } = bootWidthControl('60%')
    bindings.resetWidth()
    expect(save).toHaveBeenCalledWith({ type: 'editorLineWidth', value: '' })
    expect(state.editorLineWidth).toBe('')
    expect(bindings.draft.value).toEqual({ amount: 1000, unit: 'px' })
    expect(preview).toHaveBeenLastCalledWith('')
  })

  it('restores the saved value when an invalid number edit is committed', () => {
    const { bindings, save, preview } = bootWidthControl('800px')
    bindings.previewNumber(valueEvent('1200'))
    bindings.previewNumber(valueEvent(''))
    bindings.commitNumber()
    expect(save).not.toHaveBeenCalled()
    expect(preview).toHaveBeenLastCalledWith('800px')
    expect(bindings.valueText.value).toBe('800')
  })

  it('discards an unfinished preview on unmount', () => {
    const { bindings, save, preview, unmount } = bootWidthControl('800px')
    bindings.previewSlider(valueEvent('1200'))
    unmount()
    expect(save).not.toHaveBeenCalled()
    expect(preview).toHaveBeenLastCalledWith('800px')
  })

  it('tracks a new preference broadcast without saving it again', async() => {
    const { bindings, state, save } = bootWidthControl('800px')
    state.editorLineWidth = '70%'
    await Vue.nextTick()
    expect(bindings.draft.value).toEqual({ amount: 70, unit: '%' })
    expect(save).not.toHaveBeenCalled()
  })
})

interface TextBoxBindings {
  inputText: Vue.Ref<string>
  invalidInput: Vue.Ref<boolean>
  handleInput: (value: string) => void
}

const bootTextBox = () => {
  vi.useFakeTimers()
  const change = vi.fn()
  const props = Vue.reactive({
    input: '800px',
    onChange: change,
    regexValidator: /^(?:$|[0-9]+(?:ch|px|%))$/,
    emitTime: 800,
    more: ''
  })
  let cleanup: (() => void) | undefined
  const scope = Vue.effectScope()
  scopes.push(scope)
  const component = loadSetup<TextBoxBindings>('prefComponents/common/textBox/index.vue', {
    vue: {
      ...Vue,
      onBeforeUnmount: (callback: () => void) => { cleanup = callback }
    },
    '@/components/icons/LinkIcon.vue': { default: {} }
  })
  const bindings = scope.run(() => component.setup(props, { expose: () => {} }))
  if (!bindings) throw new Error('Text box did not initialize')
  return { bindings, props, change, unmount: () => cleanup?.() }
}

describe('legacy width text box delayed input', () => {
  it('does not overwrite a newer width chosen through the slider', async() => {
    const { bindings, props, change } = bootTextBox()
    bindings.handleInput('600px')
    props.input = '1200px'
    await Vue.nextTick()
    vi.advanceTimersByTime(1000)
    expect(bindings.inputText.value).toBe('1200px')
    expect(change).not.toHaveBeenCalled()
  })

  it('does not commit a stale valid value after the input becomes invalid', () => {
    const { bindings, change } = bootTextBox()
    bindings.handleInput('600px')
    bindings.handleInput('600')
    vi.advanceTimersByTime(1000)
    expect(bindings.invalidInput.value).toBe(true)
    expect(change).not.toHaveBeenCalled()
  })

  it('still commits the final valid typed value after the original debounce interval', () => {
    const { bindings, change } = bootTextBox()
    bindings.handleInput('600px')
    vi.advanceTimersByTime(400)
    bindings.handleInput('650px')
    vi.advanceTimersByTime(799)
    expect(change).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(change).toHaveBeenCalledExactlyOnceWith('650px')
  })

  it('cancels a queued save when the preferences control is closed', () => {
    const { bindings, change, unmount } = bootTextBox()
    bindings.handleInput('600px')
    unmount()
    vi.advanceTimersByTime(1000)
    expect(change).not.toHaveBeenCalled()
  })
})
