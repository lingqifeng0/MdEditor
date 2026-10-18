export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export const PLUGIN_API_VERSION = 2 as const
export const PLUGIN_PERMISSIONS = ['editor.read', 'editor.write', 'files.read', 'files.write', 'ui', 'links', 'desktop', 'network'] as const
export type PluginPermission = typeof PLUGIN_PERMISSIONS[number]

export interface PluginManifest {
  formatVersion: 2
  apiVersion: 2
  id: string
  name: string
  version: string
  description?: string
  author?: string
  main: string
  permissions: PluginPermission[]
  isDesktopOnly: true
}

export type PluginErrorCode = 'INVALID_PACKAGE' | 'INCOMPATIBLE_API' | 'PERMISSION_DENIED' | 'NOT_FOUND' | 'STALE_DOCUMENT' | 'DOCUMENT_INACTIVE' | 'INVALID_ARGUMENT' | 'TIMEOUT' | 'PLUGIN_DISABLED' | 'PLUGIN_FAILED'
export class PluginError extends Error {
  constructor(public readonly code: PluginErrorCode, message: string) {
    super(message)
    this.name = 'PluginError'
  }
}

export interface Disposable { dispose(): void | Promise<void> }
export interface PluginPaths { code: string; data: string; userData: string; application: string }
export interface AppInfo { version: string; apiVersion: 2; platform: string; paths: PluginPaths; capabilities: string[] }

/** Ranges refer to UTF-16 offsets in canonical Markdown; the end is exclusive. */
export interface TextRange { from: number; to: number }
export interface TextSelection { anchor: number; head: number }
export interface DocumentSnapshot {
  id: string
  windowId: number
  path: string | null
  name: string
  revision: number
  markdown: string
  selection: TextSelection | null
  dirty: boolean
  mode: 'wysiwyg' | 'source'
}
export interface TextChange extends TextRange { text: string }
export interface EditTransaction {
  documentId: string
  expectedRevision: number
  changes: TextChange[]
  selection?: TextSelection
  viewport?: 'preserve' | 'reveal-selection'
}
export interface CommandContext { windowId: number; document: DocumentSnapshot | null }
export interface CommandDefinition {
  id: string
  name: string
  hotkey?: string
  callback(context: CommandContext): void | Promise<void>
}
export interface LinkContext extends CommandContext { href: string; text?: string; modifiers: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean } }
export interface PluginEvents {
  'document-changed': DocumentSnapshot
  'active-document-changed': CommandContext
  'settings-changed': { values: Record<string, Json> }
  'theme-changed': { dark: boolean }
}
export interface HeadingMetadata extends TextRange { level: number; text: string }
export interface LinkMetadata extends TextRange { href: string; text: string; image: boolean }
export interface DocumentMetadata { revision: number; headings: HeadingMetadata[]; links: LinkMetadata[] }

export type ViewPlacement = 'sidebar' | 'tab' | 'bottom' | 'dialog' | 'settings'
export interface ViewDefinition { id: string; title: string; placement: ViewPlacement; html: string }
export interface ButtonDefinition { id: string; label: string; commandId: string; icon?: string; placement: 'toolbar' | 'statusbar' }
export type SettingField =
  | { key: string; label: string; description?: string; type: 'text' | 'file'; default?: string }
  | { key: string; label: string; description?: string; type: 'number'; default?: number; min?: number; max?: number }
  | { key: string; label: string; description?: string; type: 'toggle'; default?: boolean }
  | { key: string; label: string; description?: string; type: 'select'; default?: string; options: Array<{ label: string; value: string }> }
export interface SettingsDefinition { id: string; title: string; fields?: SettingField[]; viewId?: string }
export interface DialogRequest { title: string; message: string; buttons: string[]; defaultId?: number; cancelId?: number }
export interface FileChoice { title?: string; directory?: boolean; multiple?: boolean; extensions?: string[] }
export interface FileInfo { path: string; directory: boolean; size: number; modifiedAt: number }
export interface RenderRequest { document: DocumentSnapshot; markdown: string; language?: string }
export interface RenderDefinition { id: string; language: string; render(request: RenderRequest): string | Promise<string> }

/** Node plugins run as trusted desktop code, outside the editor renderer. */
export interface PluginContext {
  readonly manifest: Readonly<PluginManifest>
  readonly app: Readonly<AppInfo>
  readonly signal: AbortSignal
  register(resource: Disposable | (() => void | Promise<void>)): Disposable
  commands: {
    register(command: CommandDefinition): Promise<Disposable>
    execute(id: string, context?: CommandContext): Promise<void>
  }
  workspace: {
    getActiveDocument(windowId?: number): Promise<DocumentSnapshot | null>
    listDocuments(): Promise<DocumentSnapshot[]>
    openFile(path: string, windowId?: number): Promise<void>
    createDocument(markdown: string, windowId?: number): Promise<void>
  }
  editor: {
    getDocument(documentId: string): Promise<DocumentSnapshot>
    /** Atomic edit: one undo unit, rejects a stale revision; preserves viewport by default. */
    edit(transaction: EditTransaction): Promise<DocumentSnapshot>
    setSelection(documentId: string, expectedRevision: number, selection: TextSelection, reveal?: boolean): Promise<void>
    undo(documentId: string): Promise<void>
    redo(documentId: string): Promise<void>
  }
  metadata: { get(documentId: string): Promise<DocumentMetadata> }
  files: {
    resolve(relativePath: string, documentId: string): Promise<string>
    readText(path: string): Promise<string>
    readBinary(path: string): Promise<Uint8Array>
    list(path: string): Promise<FileInfo[]>
    stat(path: string): Promise<FileInfo>
    writeText(path: string, text: string): Promise<void>
    createFolder(path: string): Promise<void>
    /** Disk writes to open documents are rejected; use editor.edit instead. */
    trash(path: string): Promise<void>
  }
  events: { on<K extends keyof PluginEvents>(event: K, callback: (payload: PluginEvents[K]) => void | Promise<void>): Promise<Disposable> }
  links: { register(callback: (context: LinkContext) => boolean | Promise<boolean>): Promise<Disposable> }
  ui: {
    /** HTML is a packaged relative file, run in an opaque-origin iframe without Node. */
    registerView(view: ViewDefinition, onMessage?: (message: Json, context: CommandContext) => Json | Promise<Json>): Promise<Disposable>
    openView(id: string, data?: Json, windowId?: number): Promise<void>
    closeView(id: string, windowId?: number): Promise<void>
    registerButton(button: ButtonDefinition): Promise<Disposable>
    notice(message: string, windowId?: number): Promise<void>
    dialog(request: DialogRequest, windowId?: number): Promise<number>
  }
  settings: {
    register(definition: SettingsDefinition): Promise<Disposable>
    read(): Promise<Record<string, Json>>
    save(values: Record<string, Json>): Promise<void>
  }
  storage: { get(key: string): Promise<Json | null>; set(key: string, value: Json): Promise<void>; remove(key: string): Promise<void> }
  markdown: { registerCodeBlock(renderer: RenderDefinition): Promise<Disposable>; render(documentId: string, markdown: string): Promise<string> }
  desktop: {
    chooseFile(options?: FileChoice, windowId?: number): Promise<string[]>
    openExternal(url: string): Promise<void>
    revealFile(path: string): Promise<void>
    readClipboardText(): Promise<string>
    writeClipboardText(text: string): Promise<void>
  }
  network: { request(url: string, options?: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<{ status: number; text: string }> }
  log: { info(message: string): void; warn(message: string): void; error(message: string): void }
}
export interface PluginModule { activate(context: PluginContext): void | Promise<void>; deactivate?(): void | Promise<void> }

export interface PluginRegistration { owner: string; kind: 'command' | 'event' | 'link' | 'view' | 'button' | 'settings' | 'renderer'; id: string; definition: Record<string, unknown> }
export interface PluginSummary { manifest: PluginManifest; enabled: boolean; status: 'disabled' | 'starting' | 'active' | 'error'; error?: string }
export interface PluginPlatformState { apiVersion: 2; paths: { userData: string; plugins: string; data: string }; plugins: PluginSummary[]; registrations: PluginRegistration[] }
export interface RendererPluginRequest { id: string; method: string; args: unknown[] }
export interface PluginResponse { id: string; value?: unknown; error?: { code: string; message: string } }
