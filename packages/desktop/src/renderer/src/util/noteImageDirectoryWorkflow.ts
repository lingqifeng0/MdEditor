import { useEditorStore } from '@/store/editor'
import { getOptionsFromState } from '@/store/help'
import { askImageOperation } from './imageOperationDialog'
import { noteImageSources } from './noteImageSources'
import type { ImageDirectoryResult } from '@shared/types/ipc'

let preparing = false
export async function prepareImageDirectory(problem: Exclude<ImageDirectoryResult, { ok: true }>, noteId: string): Promise<{ pathname: string; directory: string } | null> {
  if (preparing) return null
  preparing = true
  let prepared: { pathname: string; directory: string } | null = null
  const store = useEditorStore()
  const note = store.currentFile
  if (!note || note.id !== noteId) { preparing = false; return null }
  const name = problem.stem || note.filename.replace(/\.[^.]+$/, '')
  const message = problem.errorCode === 'unsaved'
    ? '这篇笔记还没有保存。是否先选择保存位置，为笔记建立同名文件夹和 assets 文件夹，再继续添加这张图片？'
    : problem.errorCode === 'wrongParent'
      ? `是否创建“${name}”文件夹，把当前笔记移入该文件夹，并创建 assets 文件夹，再继续添加这张图片？\n已有图片会保留，目标位置已有文件时不会覆盖。`
      : '当前笔记目录中没有 assets 文件夹。是否创建 assets 文件夹，再继续添加这张图片？'
  try {
    await askImageOperation({
      title: problem.errorCode === 'unsaved' ? '先保存笔记并创建图片目录' : '创建笔记图片目录',
      message,
      confirmLabel: problem.errorCode === 'unsaved' ? '选择保存位置' : '创建并继续',
      onConfirm: async() => {
        if (store.currentFile?.id !== noteId) throw new Error('当前笔记已切换，请取消后重新添加图片。')
        const destination = problem.errorCode === 'unsaved'
          ? await window.electron.dialog.showSave({ title: '保存笔记并创建同名文件夹', defaultPath: `${name}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
          : undefined
        if (destination === null) return false
        if (store.currentFile?.id !== noteId) throw new Error('当前笔记已切换，请取消后重新添加图片。')
        store.flushActiveEditor()
        const current = store.currentFile
        const savedOptions = getOptionsFromState(current)
        const options = { ...savedOptions, encoding: { ...savedOptions.encoding } }
        const pathname = current.pathname || ''
        const markdown = current.markdown
        const result = await window.electron.images.prepareDirectory({ pathname, destination, markdown, options, resources: noteImageSources(markdown) })
        if (!result.ok) throw new Error(result.error)
        store.APPLY_FILE_PATH({ id: noteId, filename: window.path.basename(result.pathname), pathname: result.pathname, savedMarkdown: markdown, savedOptions: options, preserveSavedState: !!pathname })
        prepared = result
        return true
      }
    })
    return prepared
  } finally { preparing = false }
}
