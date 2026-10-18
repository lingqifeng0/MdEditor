import { shell } from 'electron'
import { ImageDraftLedger } from './imageDrafts'

// Saving and discarding must share the same ledger and pending-write barrier.
export const imageDrafts = new ImageDraftLedger(pathname => shell.trashItem(pathname))
