import { shell } from 'electron'
import type { WebContents } from 'electron'
import { ImageDraftLedger } from './imageDrafts'

// Saving and discarding must share the same ledger and pending-write barrier.
export const imageDrafts = new ImageDraftLedger(pathname => shell.trashItem(pathname))

const movedNoteOwners = new WeakMap<WebContents, Map<string, string>>()

export const getDraftOwner = (sender: WebContents, noteId: string): string =>
  movedNoteOwners.get(sender)?.get(noteId) ?? `${sender.id}:${noteId}`

export const transferDraftOwner = (source: WebContents, target: WebContents, noteId: string): void => {
  const owners = movedNoteOwners.get(target) ?? new Map<string, string>()
  // Continue using the original ledger key so this tab's pending saves stay ordered.
  owners.set(noteId, getDraftOwner(source, noteId))
  movedNoteOwners.set(target, owners)
}
