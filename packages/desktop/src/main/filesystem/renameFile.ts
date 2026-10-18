import { move } from 'fs-extra'
import path from 'node:path'
import { getRenamedFilename } from 'common/filename'

export const renameFileWithoutOverwrite = async(src: string, dest: string): Promise<void> => {
  const source = path.normalize(src)
  const destination = path.normalize(dest)
  const directoryKey = (pathname: string): string => {
    const directory = path.dirname(pathname)
    return process.platform === 'win32' ? directory.toLowerCase() : directory
  }
  if (
    !path.isAbsolute(src) ||
    !path.isAbsolute(dest) ||
    directoryKey(source) !== directoryKey(destination) ||
    getRenamedFilename(path.basename(destination), path.basename(source)) !== path.basename(destination)
  ) {
    throw new Error('Invalid file name.')
  }
  if (source === destination) return

  await move(source, destination, { overwrite: false })
}
