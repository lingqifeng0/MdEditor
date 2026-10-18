export interface FloatingTocEntry {
  slug: string
  label: string
  level: number
  index: number
  parentSlug: string | null
  hasChildren: boolean
}

export function deriveFloatingToc(
  headings: ReadonlyArray<{ slug?: unknown; content?: unknown; lvl: number | null }>
): FloatingTocEntry[] {
  const entries: FloatingTocEntry[] = []
  const ancestors: FloatingTocEntry[] = []
  headings.forEach((heading, index) => {
    if (typeof heading.slug !== 'string' || !heading.slug || !heading.lvl || heading.lvl < 1 || heading.lvl > 6) return
    while (ancestors.length && ancestors[ancestors.length - 1]!.level >= heading.lvl) ancestors.pop()
    const parent = ancestors[ancestors.length - 1]
    if (parent) parent.hasChildren = true
    const entry: FloatingTocEntry = {
      slug: heading.slug,
      label: typeof heading.content === 'string' ? heading.content : '',
      level: heading.lvl,
      index,
      parentSlug: parent?.slug ?? null,
      hasChildren: false
    }
    entries.push(entry)
    ancestors.push(entry)
  })
  return entries
}

export function visibleFloatingToc(entries: readonly FloatingTocEntry[], collapsed: ReadonlySet<string>): FloatingTocEntry[] {
  const hidden = new Set<string>()
  return entries.filter((entry) => {
    if (entry.parentSlug && (collapsed.has(entry.parentSlug) || hidden.has(entry.parentSlug))) {
      hidden.add(entry.slug)
      return false
    }
    return true
  })
}

export function floatingTocAncestors(entries: readonly FloatingTocEntry[], slug: string | null): Set<string> {
  const bySlug = new Map(entries.map(entry => [entry.slug, entry]))
  const ancestors = new Set<string>()
  let parent = slug ? bySlug.get(slug)?.parentSlug : null
  while (parent && !ancestors.has(parent)) {
    ancestors.add(parent)
    parent = bySlug.get(parent)?.parentSlug
  }
  return ancestors
}

/** Positions are measured afresh: body edits and image loads can move headings without changing the outline. */
export function findFloatingTocActive(
  positions: ReadonlyArray<{ slug: string; top: number }>, viewportTop: number, atBottom = false
): string | null {
  if (!positions.length) return null
  if (atBottom) return positions[positions.length - 1]!.slug
  let active = positions[0]!.slug
  for (const heading of positions) {
    if (heading.top > viewportTop + 25) break
    active = heading.slug
  }
  return active
}

export function floatingTocOutline(entries: readonly FloatingTocEntry[]): string {
  return entries.map(entry => `${'    '.repeat(entry.level - 1)}${entry.label}`).join('\n')
}

export function searchFloatingToc(entries: readonly FloatingTocEntry[], query: string): Set<string> {
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase()
  return new Set(needle ? entries.filter(entry => entry.label.normalize('NFKC').toLocaleLowerCase().includes(needle)).map(entry => entry.slug) : [])
}

export function revealFloatingTocMatches(entries: readonly FloatingTocEntry[], collapsed: ReadonlySet<string>, matches: ReadonlySet<string>): Set<string> {
  const result = new Set(collapsed)
  for (const slug of matches) {
    for (const parent of floatingTocAncestors(entries, slug)) result.delete(parent)
  }
  return result
}
