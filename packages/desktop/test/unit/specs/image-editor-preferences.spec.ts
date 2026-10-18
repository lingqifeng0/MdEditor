import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from 'vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'

interface PreferencesBindings {
  choosingEditor: Vue.Ref<boolean>
  chooseEditor: () => Promise<void>
  onSelectChange: (key: string, value: unknown) => void
}

const bootPreferences = (savedPath = '') => {
  const filename = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/renderer/src/prefComponents/image/index.vue')
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const compiled = compileScript(descriptor, { id: 'image-editor-preferences', fs: { fileExists: existsSync, readFile: (filename) => readFileSync(filename, 'utf8') } })
  const script = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const state = Vue.reactive({ imageEditorPath: savedPath, imageInsertAction: 'path' })
  const save = vi.fn(({ type, value }: { type: string; value: unknown }) => {
    if (type === 'imageEditorPath') state.imageEditorPath = String(value)
  })
  const dependencies: Record<string, unknown> = {
    vue: Vue,
    pinia: { storeToRefs: () => ({ imageEditorPath: Vue.toRef(state, 'imageEditorPath'), imageInsertAction: Vue.toRef(state, 'imageInsertAction') }) },
    'vue-i18n': { useI18n: () => ({ t: (key: string) => key }) },
    '@/store/preferences': { usePreferencesStore: () => ({ SET_SINGLE_PREFERENCE: save }) },
    './config': { getImageActions: () => [] }
  }
  for (const component of ['../common/separator/index.vue', './components/uploader/index.vue', '../common/select/index.vue', './components/folderSetting/index.vue', '../common/textBox/index.vue']) {
    dependencies[component] = { default: {} }
  }
  // Execute the real setup with reactive refs; the unit runner does not install an SFC plugin.
  // eslint-disable-next-line no-new-func
  const factory = new Function('require', 'exports', 'module', `${script}\nreturn module.exports`) as (require: (name: string) => unknown, exports: object, module: object) => { default: { setup: (props: object, context: { expose: () => void }) => PreferencesBindings } }
  const module = { exports: {} }
  const component = factory(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected image preferences dependency: ${name}`)
    return dependencies[name]
  }, module.exports, module).default
  const chooseEditor = vi.fn()
  Object.defineProperty(window, 'electron', { configurable: true, value: { images: { chooseEditor } } })
  const bindings = component.setup({}, { expose: () => {} })
  return { state, save, chooseEditor, bindings }
}

describe('image editor preferences setup and picker', () => {
  it('only reads preferences when the pane opens', () => {
    const { state, save, chooseEditor } = bootPreferences('C:\\编辑器\\Image Editor.exe')
    expect(state.imageEditorPath).toBe('C:\\编辑器\\Image Editor.exe')
    expect(save).not.toHaveBeenCalled()
    expect(chooseEditor).not.toHaveBeenCalled()
  })

  it('persists a chosen Unicode path as one preference and releases the busy state', async() => {
    const { state, save, chooseEditor, bindings } = bootPreferences('old.exe')
    chooseEditor.mockResolvedValue('C:\\图片程序\\Image Editor.exe')
    const request = bindings.chooseEditor()
    expect(bindings.choosingEditor.value).toBe(true)
    await request
    expect(chooseEditor).toHaveBeenCalledExactlyOnceWith('old.exe')
    expect(save).toHaveBeenCalledExactlyOnceWith({ type: 'imageEditorPath', value: 'C:\\图片程序\\Image Editor.exe' })
    expect(state.imageEditorPath).toBe('C:\\图片程序\\Image Editor.exe')
    expect(bindings.choosingEditor.value).toBe(false)
  })

  it('keeps canceled selection unchanged and clears only the configured program', async() => {
    const { state, save, chooseEditor, bindings } = bootPreferences('old.exe')
    chooseEditor.mockResolvedValue(null)
    await bindings.chooseEditor()
    expect(state.imageEditorPath).toBe('old.exe')
    expect(save).not.toHaveBeenCalled()
    bindings.onSelectChange('imageEditorPath', '')
    expect(save).toHaveBeenCalledExactlyOnceWith({ type: 'imageEditorPath', value: '' })
    expect(state.imageEditorPath).toBe('')
    expect(state.imageInsertAction).toBe('path')
  })
})
