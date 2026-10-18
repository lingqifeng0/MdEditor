export const isLocalAttachmentHref = (href: string): boolean => {
  const target = href.trim().replace(/^<(.+)>$/, '$1')
  if (!target || target.startsWith('#') || [...target].some(character => character.charCodeAt(0) < 32)) return false
  return /^[a-z]:[\\/]/i.test(target) || /^file:/i.test(target) || !/^[a-z][a-z\d+.-]*:/i.test(target)
}
