import { marked } from 'marked';

/** Sources in actual image tokens and rendered HTML, excluding Markdown code examples. */
export function collectMarkdownImageSources(markdown: string, unique = true): string[] {
    const sources: string[] = [];
    marked.walkTokens(marked.lexer(markdown), (token) => {
        if (token.type === 'image')
            sources.push(token.href);
        if (token.type === 'html') {
            const html = new DOMParser().parseFromString(token.text, 'text/html');
            for (const image of html.querySelectorAll('img[src]'))
                sources.push(image.getAttribute('src')!);
        }
    });
    return unique ? [...new Set(sources)] : sources;
}
