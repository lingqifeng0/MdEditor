const encodeLocalPath = (pathname: string, preserveEscapes = false): string => {
  const encoded = encodeURI(pathname.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F')
  return preserveEscapes ? encoded.replace(/%25([\da-f]{2})/gi, '%$1') : encoded
}

export const localPathToFileUrl = (pathname: string, preserveEscapes = false): string => {
  const encoded = encodeLocalPath(pathname, preserveEscapes)
  if (encoded.startsWith('//')) return `file:${encoded}`
  if (/^[a-z]:\//i.test(encoded)) return `file:///${encoded}`
  return `file://${encoded}`
}

export const resolveHtmlImageSource = (src: string, documentDirectory: string): string => {
  if (/^(?:https?:|data:|blob:|file:)/i.test(src)) return src
  if (/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(src)) return localPathToFileUrl(src, true)
  if (!documentDirectory) return src
  try {
    const base = `${localPathToFileUrl(documentDirectory).replace(/\/$/, '')}/`
    return new URL(encodeLocalPath(src, true), base).href
  } catch {
    return src
  }
}
