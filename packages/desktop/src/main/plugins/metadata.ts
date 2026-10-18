import type { DocumentMetadata, DocumentSnapshot } from '@shared/plugin-api'

export function getDocumentMetadata(document: DocumentSnapshot): DocumentMetadata {
  const headings: DocumentMetadata['headings'] = []
  const links: DocumentMetadata['links'] = []
  let offset = 0
  let fence: string | null = null
  for (const line of document.markdown.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (marker) {
      if (!fence) fence = marker[1]!
      else if (marker[1]![0] === fence[0] && marker[1]!.length >= fence.length) fence = null
    } else if (!fence) {
      const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
      if (heading) headings.push({ level: heading[1]!.length, text: heading[2]!, from: offset, to: offset + line.length })
      const pattern = /(!?)\[([^\]]*)\]\(([^\s)]+|<[^>]*>)(?:\s+"[^"]*")?\)/g
      for (const match of line.matchAll(pattern)) links.push({ image: !!match[1], text: match[2]!, href: match[3]!.replace(/^<|>$/g, ''), from: offset + match.index!, to: offset + match.index! + match[0].length })
    }
    offset += line.length + 1
  }
  return { revision: document.revision, headings, links }
}
