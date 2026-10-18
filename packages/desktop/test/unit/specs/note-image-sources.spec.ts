import { describe, it, expect } from 'vitest'
import { noteImageSources } from '@/util/noteImageSources'

describe('note image watcher sources', () => {
  it('includes inline, reference, resized HTML, and grouped HTML local images', () => {
    const md = '![A](assets/a.png)\n\n![B][ref]\n\n[ref]: images/b.png\n\n<img src="assets/c.png" width="100">\n\n<div>\n<img src="images/d.png">\n</div>'
    expect(noteImageSources(md)).toEqual(['assets/a.png', 'images/b.png', 'assets/c.png', 'images/d.png'])
  })
  it('excludes remote URLs, inline code and fenced samples, and deduplicates file URLs', () => {
    const md = '![A](file:///C:/note/a.png)\n![B](file:///C:/note/a.png)\n![R](https://example.com/a.png)\n\n`![code](skip.png)`\n\n```html\n<img src="skip2.png">\n```'
    expect(noteImageSources(md)).toEqual(['file:///C:/note/a.png'])
  })
})
