/**
 * Minimal Markdown parser for release notes (the subset CHANGELOG.md uses): `#` to `####` headings, paragraphs,
 * `-` / `*` bullet lists (continuation lines indented), `**bold**`, `*italic*`, `` `code` `` and `[text](url)`.
 * The output is plain data rendered by MarkdownView.vue with Vue nodes, never as HTML, so notes cannot inject
 * markup.
 */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] }

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; children: Inline[] }
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'list'; items: Inline[][] }

const HEADING_RE = /^(#{1,4})\s+(.*)$/
const BULLET_RE = /^[-*]\s+(.*)$/

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let items: string[][] | null = null

  const flushParagraph = (): void => {
    if (paragraph.length)
      blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join(' ')) })
    paragraph = []
  }
  const flushList = (): void => {
    if (items)
      blocks.push({ kind: 'list', items: items.map((lines) => parseInline(lines.join(' '))) })
    items = null
  }

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = HEADING_RE.exec(trimmed)
    if (heading && line === trimmed) {
      flushParagraph()
      flushList()
      const level = heading[1].length as 1 | 2 | 3 | 4
      blocks.push({
        kind: 'heading',
        level,
        children: parseInline(heading[2].replace(/\s+#+$/, ''))
      })
      continue
    }
    const bullet = BULLET_RE.exec(trimmed)
    if (bullet && line === trimmed) {
      flushParagraph()
      items ??= []
      items.push([bullet[1]])
      continue
    }
    if (items && line !== trimmed) {
      // Indented continuation of the last bullet.
      items[items.length - 1].push(trimmed)
      continue
    }
    flushList()
    paragraph.push(trimmed)
  }
  flushParagraph()
  flushList()
  return blocks
}

/** Inline markup; unmatched markers stay as text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let buffer = ''
  const pushText = (): void => {
    if (buffer) out.push({ kind: 'text', text: buffer })
    buffer = ''
  }
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    if (rest.startsWith('`')) {
      const end = text.indexOf('`', i + 1)
      if (end > i + 1) {
        pushText()
        out.push({ kind: 'code', text: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (rest.startsWith('**')) {
      const end = text.indexOf('**', i + 2)
      if (end > i + 2) {
        pushText()
        out.push({ kind: 'strong', children: parseInline(text.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if (rest.startsWith('*') && !rest.startsWith('**') && rest[1] !== ' ') {
      const end = text.indexOf('*', i + 1)
      if (end > i + 1 && text[end - 1] !== ' ') {
        pushText()
        out.push({ kind: 'em', children: parseInline(text.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    if (rest.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest)
      if (link) {
        pushText()
        out.push({ kind: 'link', href: link[2], children: parseInline(link[1]) })
        i += link[0].length
        continue
      }
    }
    buffer += text[i]
    i++
  }
  pushText()
  return out
}
