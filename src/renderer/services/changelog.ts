// The changelog is bundled at build time; the release workflow dates its "Unreleased" section first.
import changelogText from '../../../CHANGELOG.md?raw'
import { parseChangelog, sectionsSince, type ChangelogSection } from '@shared/changelog'

export const REPO_URL = 'https://github.com/sbilodeau/blocksmith-studio'
export const RELEASES_URL = `${REPO_URL}/releases`

let parsed: ChangelogSection[] | null = null

/**
 * Markdown notes for the versions after `previous` up to `current` (see sectionsSince); each version gets its own
 * heading when there are several. '' when there is nothing to show.
 */
export function changelogNotes(
  previous: string | null,
  current: string,
  text: string = changelogText
): string {
  const sections = text === changelogText ? (parsed ??= parseChangelog(text)) : parseChangelog(text)
  const picked = sectionsSince(sections, previous, current)
  if (picked.length <= 1) return picked[0]?.body ?? ''
  return picked
    .map((s) => `## ${s.version}${s.date ? ` - ${s.date}` : ''}\n\n${s.body}`)
    .join('\n\n')
}

/** Where a link in the notes opens: https as is, a repository path (docs/x.md) on GitHub; null for anything else. */
export function noteLinkUrl(href: string): string | null {
  if (/^https:\/\//i.test(href)) return href
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//'))
    return null
  const path = href.replace(/^\.?\//, '')
  return path ? `${REPO_URL}/blob/main/${path}` : null
}
