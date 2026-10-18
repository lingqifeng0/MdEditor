/* eslint-disable no-template-curly-in-string -- These assertions contain literal NSIS macro references. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The NSIS script cannot be executed here, so assert the properties that keep
// the Windows Markdown association alive across an update (#4966).
// electron-builder runs the previous version's uninstaller with `--updated`
// before it installs. Registering behind a prompt while unregistering
// unconditionally therefore left the ProgId deleted after any update answered
// "No": an "Open with" choice pinned to it pointed at nothing and Explorer's
// double-click silently did nothing.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const script = readFileSync(
  path.resolve(__dirname, '../../../build/windows/installer.nsh'),
  'utf8'
)

const associationScript = readFileSync(path.resolve(__dirname, '../../../build/windows/file-associations.nsh'), 'utf8')
const builder = readFileSync(path.resolve(__dirname, '../../../electron-builder.yml'), 'utf8')
const EXTENSIONS = ['.md', '.markdown', '.mmd', '.mdown', '.mdtxt', '.mdtext']

const macroBody = (name: string, source = script): string => {
  const start = source.indexOf(`!macro ${name}`)
  expect(start, `the ${name} macro is missing`).toBeGreaterThan(-1)
  const end = source.indexOf('!macroend', start)
  expect(end, `the ${name} macro is not terminated`).toBeGreaterThan(start)
  return source.slice(start, end)
}

const customInstall = macroBody('customInstall')
const customUnInstall = macroBody('customUnInstall')
const associate = macroBody('APP_ASSOCIATE', associationScript)
const unassociate = macroBody('APP_UNASSOCIATE', associationScript)

describe('Windows Markdown file association (build/windows/installer.nsh)', () => {
  it('keeps the ProgId name an existing "Open with" choice points at', () => {
    expect(builder.match(/name: MarkTextToolbar\.Document/g)).toHaveLength(EXTENSIONS.length)
    expect(builder).toContain('executableName: MarkTextToolbar')
    expect(macroBody('customHeader')).toContain('!include "${MARKTEXT_TOOLBAR_ASSOCIATIONS}"')
  })

  it('registers without prompting, so no answer can leave the ProgId deleted', () => {
    expect(customInstall).not.toMatch(/MessageBox/)
    expect(associate).not.toMatch(/MessageBox/)
  })

  it('claims every Markdown extension for the ProgId', () => {
    for (const ext of EXTENSIONS) {
      expect(builder, `${ext} is not associated`).toContain(`- ext: ${ext.slice(1)}`)
    }
    expect(associate).toContain('${FILECLASS}')
  })

  it('offers the ProgId in the "Open with" dialog, which is what a UserChoice pins', () => {
    expect(associate).toContain('OpenWithProgids')
    expect(associate).not.toMatch(/WriteRegStr[^\n]*Classes\\\.\$\{EXT\}"/)
  })

  it('quotes the executable path in every open command it writes', () => {
    const commands = associate.match(/[^\n]*shell\\open\\command[^\n]*/g) ?? []
    expect(commands.length, 'no open command is written').toBeGreaterThan(0)
    for (const command of commands) {
      expect(command).toContain('"$appExe" "%1"')
    }
  })

  it('keeps the association when the uninstaller runs as part of an update', () => {
    const guardStart = unassociate.search(/\$\{ifNot\}\s+\$\{isUpdated\}/)
    expect(guardStart, 'the removal is not guarded by isUpdated').toBeGreaterThan(-1)
    const guarded = unassociate.slice(guardStart)
    const guardEnd = guarded.lastIndexOf('${endIf}')
    expect(guardEnd, 'the isUpdated guard is not closed').toBeGreaterThan(-1)
    const guardedBody = guarded.slice(0, guardEnd)
    expect(guardedBody).toContain('DeleteRegValue SHELL_CONTEXT "Software\\Classes\\.${EXT}\\OpenWithProgids" "${FILECLASS}"')
    expect(guardedBody).toContain('DeleteRegKey SHELL_CONTEXT "Software\\Classes\\${FILECLASS}"')
  })

  it('does not delete the extension keys themselves on uninstall', () => {
    // They also hold the OpenWithProgids entries of every other Markdown
    // editor the user has installed.
    for (const ext of EXTENSIONS) {
      expect(unassociate + customUnInstall, `${ext} is deleted wholesale`).not.toMatch(
        new RegExp(`DeleteRegKey[^\\n]*Classes\\\\\\${ext}"`)
      )
    }
    expect(unassociate).not.toMatch(/DeleteRegKey[^\n]*Classes\\\.\$\{EXT\}"/)
  })
})
