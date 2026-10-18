/** Extends the regex match past nested copies of the same tag, retaining source offsets. */
export function extendNestedHtmlMatch(source: string, match: RegExpExecArray): void {
    if (!match[3] || !match[5])
        return;
    const tag = match[3].toLowerCase();
    const tags = /<!--[\s\S]*?-->|<\/?([a-z][a-z\d-]*)(?:\s(?:[^"'<>]|"[^"]*"|'[^']*')*|\/)?>/gi;
    tags.lastIndex = match[2].length;
    let depth = 1;
    // The inline HTML regex only sees the first closing tag. The document model
    // needs the outer closing tag or a colored span inside an aligned span splits.
    for (let next = tags.exec(source); next; next = tags.exec(source)) {
        if (next[1]?.toLowerCase() !== tag)
            continue;
        if (next[0].startsWith('</'))
            depth--;
        else if (!next[0].endsWith('/>'))
            depth++;
        if (depth === 0) {
            match[0] = source.slice(0, tags.lastIndex);
            match[4] = source.slice(match[2].length, next.index);
            match[5] = next[0];
            return;
        }
    }
}
