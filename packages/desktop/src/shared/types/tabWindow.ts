import type { ISerializedHistory } from '@muyajs/core'
import type { FileNotification, IFileState } from './files'

export interface TabWindowView {
  editorHistory?: ISerializedHistory
  saveHistory?: Array<[string, number]>
  sourceHistory?: unknown
  sourceScrollTop?: number
}

export interface TabWindowCapture {
  tabId: string
  view: TabWindowView
}

export interface DeletedNoteImage {
  noteId: string
  src: string
  token: string
  remaining: number
  restored: boolean
  failed?: boolean
}

export interface TabWindowTransfer {
  file: Omit<IFileState, 'blocks' | 'searchMatches' | 'notifications'> & {
    notifications: Omit<FileNotification, 'action'>[]
  }
  view: TabWindowView
  sourceCode: boolean
  hasDraftImages: boolean
  deletedImages: DeletedNoteImage[]
}
