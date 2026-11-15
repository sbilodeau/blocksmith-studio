/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS: return types are in JSDoc */
/**
 * CalVer helpers for Blocksmith Studio releases.
 *
 * Format: `YY.W.FIX`
 * - `YY`  = ISO week-year modulo 100 (2026-12-31 and 2027-01-01 both belong to ISO week-year 2026)
 * - `W`   = ISO week number (1-53), no leading zero so the version stays semver-valid
 * - `FIX` = releases already tagged in that ISO week (first release of the week = 0)
 *
 * All computations use UTC so the result does not depend on the machine time zone.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Strict release tag: `v` + three semver numbers without leading zeros, nothing else. */
const TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/**
 * ISO 8601 week-year and week number of a date (UTC calendar day).
 * @param {Date} date
 * @returns {{ year: number, week: number }}
 */
export function isoWeek(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('isoWeek: invalid date')
  }
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  // ISO weeks start on Monday; a week belongs to the year that contains its Thursday.
  const weekday = day.getUTCDay() || 7
  day.setUTCDate(day.getUTCDate() + 4 - weekday)
  const year = day.getUTCFullYear()
  const dayOfYear = Math.round((day.getTime() - Date.UTC(year, 0, 1)) / DAY_MS) + 1
  return { year, week: Math.ceil(dayOfYear / 7) }
}

/**
 * Parses a release tag such as `v26.46.0`. Returns null for anything else.
 * @param {string} tag
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseTag(tag) {
  const match = TAG_RE.exec(String(tag).trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/**
 * Next release version for `date`, given the existing git tags.
 * FIX is the number of releases already tagged in that ISO week. If the tags have gaps (e.g. a deleted
 * tag), `highest FIX + 1` is used instead so the result never collides with an existing tag.
 * @param {readonly string[]} tags existing tags (`git tag --list 'v*'`); malformed entries are ignored
 * @param {Date} date release date
 * @returns {string} e.g. `26.46.0`
 */
export function nextVersion(tags, date) {
  const { year, week } = isoWeek(date)
  const yy = year % 100
  let count = 0
  let highest = -1
  for (const tag of tags) {
    const parsed = parseTag(tag)
    if (!parsed || parsed.major !== yy || parsed.minor !== week) continue
    count += 1
    highest = Math.max(highest, parsed.patch)
  }
  return `${yy}.${week}.${Math.max(count, highest + 1)}`
}

/**
 * Parses a `YYYY-MM-DD` string into a UTC date. Throws on malformed or impossible dates.
 * @param {string} value
 * @returns {Date}
 */
export function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match) {
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
    const date = new Date(Date.UTC(y, m - 1, d))
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) {
      return date
    }
  }
  throw new RangeError(`Invalid date "${value}", expected YYYY-MM-DD`)
}
