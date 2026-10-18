import { collectMarkdownImageSources } from '@muyajs/core'

export function noteImageSources(markdown: string): string[] {
  return collectMarkdownImageSources(markdown).filter(src => src && !/^(?:https?:|data:|blob:|\/\/)/i.test(src))
}
