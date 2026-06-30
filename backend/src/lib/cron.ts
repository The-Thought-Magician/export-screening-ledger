// ----------------------------------------------------------------------------
// cron.ts — THE ENGINE
//
// Pure, deterministic schedule-analysis functions used by the route handlers.
// No external services, no DB access, no side effects. Everything here takes
// plain inputs and returns plain typed outputs so it is trivially testable.
//
// Three schedule "kinds" are supported uniformly:
//   - 'cron'   : a standard 5/6-field cron expression, evaluated in a timezone
//                via cron-parser v5 (CronExpressionParser).
//   - 'rate'   : "every N minutes|hours|days", computed arithmetically.
//   - 'oneoff' : a single ISO instant; fires once if it is in the future.
// ----------------------------------------------------------------------------

import { CronExpressionParser } from 'cron-parser'

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface Job {
  id: string
  kind: ScheduleKind
  expr: string
  timezone: string
  resourceId?: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface Collision {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export type DstTrapType = 'double_fire' | 'skip' | 'ambiguous'

export interface DstTrap {
  type: DstTrapType
  atLocal: string
  atUtc: string
}

export interface CoverageWindow {
  // A window during which at least one job is *expected* to fire, expressed
  // as a local-time daily span [startMinute, endMinute) in minutes-of-day.
  startMinute: number
  endMinute: number
  label?: string
}

export interface CoverageGap {
  windowStart: string
  windowEnd: string
  reason: string
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// ----------------------------------------------------------------------------
// rate-expression parsing  ("every N minutes|hours|days")
// ----------------------------------------------------------------------------

interface RateSpec {
  n: number
  unit: 'minutes' | 'hours' | 'days'
  ms: number
}

function parseRate(expr: string): RateSpec | null {
  const m = expr.trim().toLowerCase().match(/^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days)$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  let unit: RateSpec['unit']
  let ms: number
  if (m[2].startsWith('minute')) {
    unit = 'minutes'
    ms = n * MINUTE_MS
  } else if (m[2].startsWith('hour')) {
    unit = 'hours'
    ms = n * HOUR_MS
  } else {
    unit = 'days'
    ms = n * DAY_MS
  }
  return { n, unit, ms }
}

// ----------------------------------------------------------------------------
// validateExpression
// ----------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  if (typeof expr !== 'string' || expr.trim() === '') {
    return { valid: false, error: 'Expression is empty' }
  }
  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(expr)
      return { valid: true }
    } catch (e) {
      return { valid: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  if (kind === 'rate') {
    const spec = parseRate(expr)
    if (!spec) return { valid: false, error: 'Expected "every N minutes|hours|days"' }
    return { valid: true }
  }
  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    if (Number.isNaN(t)) return { valid: false, error: 'Not a valid ISO timestamp' }
    return { valid: true }
  }
  return { valid: false, error: `Unknown schedule kind: ${kind}` }
}

// ----------------------------------------------------------------------------
// describeExpression
// ----------------------------------------------------------------------------

export function describeExpression(kind: ScheduleKind, expr: string, timezone: string): string {
  const tz = timezone || 'UTC'
  if (kind === 'rate') {
    const spec = parseRate(expr)
    if (!spec) return 'Invalid rate expression'
    return `Every ${spec.n} ${spec.n === 1 ? spec.unit.replace(/s$/, '') : spec.unit}`
  }
  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    if (Number.isNaN(t)) return 'Invalid one-off timestamp'
    return `Once at ${new Date(t).toISOString()}`
  }
  // cron
  const fields = expr.trim().split(/\s+/)
  if (fields.length < 5) return 'Invalid cron expression'
  const [min, hour, dom, mon, dow] = fields
  const parts: string[] = []
  if (min === '*' && hour === '*') {
    parts.push('every minute')
  } else if (hour === '*') {
    parts.push(`at minute ${min} of every hour`)
  } else if (min !== '*' && hour !== '*' && !min.includes('*') && !hour.includes('*')) {
    const h = parseInt(hour, 10)
    const m = parseInt(min, 10)
    if (Number.isFinite(h) && Number.isFinite(m)) {
      const hh = String(h).padStart(2, '0')
      const mm = String(m).padStart(2, '0')
      parts.push(`at ${hh}:${mm}`)
    } else {
      parts.push(`at minute ${min}, hour ${hour}`)
    }
  } else {
    parts.push(`at minute ${min}, hour ${hour}`)
  }
  if (dom !== '*') parts.push(`on day-of-month ${dom}`)
  if (mon !== '*') parts.push(`in month ${mon}`)
  if (dow !== '*') parts.push(`on day-of-week ${dow}`)
  return `${parts.join(', ')} (${tz})`
}

// ----------------------------------------------------------------------------
// nextFirings — the core "when does this fire" function
// Returns up to `count` ISO-8601 UTC instants on/after fromISO.
// ----------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone: string,
  fromISO: string,
  count: number,
): string[] {
  const tz = timezone || 'UTC'
  const fromMs = Date.parse(fromISO)
  const from = Number.isNaN(fromMs) ? new Date() : new Date(fromMs)
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return []

  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    if (Number.isNaN(t)) return []
    return t > from.getTime() ? [new Date(t).toISOString()] : []
  }

  if (kind === 'rate') {
    const spec = parseRate(expr)
    if (!spec) return []
    const out: string[] = []
    // First firing is one interval after `from` (treat `from` as the anchor).
    let cursor = from.getTime() + spec.ms
    for (let i = 0; i < n; i++) {
      out.push(new Date(cursor).toISOString())
      cursor += spec.ms
    }
    return out
  }

  // cron
  try {
    const interval = CronExpressionParser.parse(expr, { tz, currentDate: from })
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      const next = interval.next()
      out.push(new Date(next.getTime()).toISOString())
    }
    return out
  } catch {
    return []
  }
}

// ----------------------------------------------------------------------------
// computeCollisions — bucket all jobs' firings by minute over a horizon and
// flag minutes where concurrency >= threshold OR >= 2 jobs share a resource.
// ----------------------------------------------------------------------------

export function computeCollisions(
  jobs: Job[],
  opts: { horizonDays: number; threshold: number },
): Collision[] {
  const horizonDays = opts.horizonDays > 0 ? opts.horizonDays : 7
  const threshold = opts.threshold > 0 ? opts.threshold : 2
  const fromISO = new Date().toISOString()
  const horizonMs = horizonDays * DAY_MS
  const fromMs = Date.parse(fromISO)
  const endMs = fromMs + horizonMs

  // minute-bucket -> set of jobIds firing in that minute
  const buckets = new Map<number, { jobIds: Set<string>; resources: Map<string, Set<string>> }>()

  for (const job of jobs) {
    // Pull enough firings to cover the horizon. Cap to a sane upper bound.
    const firings = nextFirings(job.kind, job.expr, job.timezone, fromISO, 5000)
    for (const iso of firings) {
      const ms = Date.parse(iso)
      if (ms > endMs) break
      const bucketKey = Math.floor(ms / MINUTE_MS)
      let b = buckets.get(bucketKey)
      if (!b) {
        b = { jobIds: new Set(), resources: new Map() }
        buckets.set(bucketKey, b)
      }
      b.jobIds.add(job.id)
      if (job.resourceId) {
        let rs = b.resources.get(job.resourceId)
        if (!rs) {
          rs = new Set()
          b.resources.set(job.resourceId, rs)
        }
        rs.add(job.id)
      }
    }
  }

  const collisions: Collision[] = []
  const sortedKeys = [...buckets.keys()].sort((a, b) => a - b)
  for (const key of sortedKeys) {
    const b = buckets.get(key)!
    const concurrency = b.jobIds.size

    // Resource contention: >= 2 distinct jobs sharing one resource in the minute.
    let contendedResource: string | undefined
    for (const [resId, rs] of b.resources) {
      if (rs.size >= 2) {
        contendedResource = resId
        break
      }
    }

    const overThreshold = concurrency >= threshold
    if (!overThreshold && !contendedResource) continue

    const windowStart = new Date(key * MINUTE_MS).toISOString()
    const windowEnd = new Date((key + 1) * MINUTE_MS).toISOString()

    let severity: Collision['severity'] = 'low'
    if (contendedResource) {
      severity = 'high'
    } else if (concurrency >= threshold * 2) {
      severity = 'high'
    } else if (concurrency > threshold) {
      severity = 'medium'
    } else {
      severity = 'low'
    }

    collisions.push({
      windowStart,
      windowEnd,
      jobIds: [...b.jobIds].sort(),
      severity,
      ...(contendedResource ? { resourceId: contendedResource } : {}),
    })
  }
  return collisions
}

// ----------------------------------------------------------------------------
// loadHeatmap — count firings per hour-bucket over the horizon.
// ----------------------------------------------------------------------------

export function loadHeatmap(
  jobs: Job[],
  opts: { horizonDays: number },
): HeatmapBucket[] {
  const horizonDays = opts.horizonDays > 0 ? opts.horizonDays : 7
  const fromISO = new Date().toISOString()
  const fromMs = Date.parse(fromISO)
  const endMs = fromMs + horizonDays * DAY_MS

  const counts = new Map<number, number>()
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone, fromISO, 5000)
    for (const iso of firings) {
      const ms = Date.parse(iso)
      if (ms > endMs) break
      const hourKey = Math.floor(ms / HOUR_MS)
      counts.set(hourKey, (counts.get(hourKey) ?? 0) + 1)
    }
  }

  return [...counts.keys()]
    .sort((a, b) => a - b)
    .map((k) => ({ bucket: new Date(k * HOUR_MS).toISOString(), count: counts.get(k)! }))
}

// ----------------------------------------------------------------------------
// dstTraps — detect DST transitions in the window and classify the trap.
//
// We walk the window in UTC and look at how the local UTC-offset of the target
// timezone changes hour-to-hour. A forward jump (offset increases) creates a
// "skip" window (local clock leaps forward → a wall-clock time never occurs).
// A backward jump (offset decreases) creates an "ambiguous"/"double_fire"
// window (a wall-clock time occurs twice).
// ----------------------------------------------------------------------------

function tzOffsetMinutes(date: Date, timeZone: string): number {
  // Returns minutes that local time is ahead of UTC for the given instant.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const asUTC = Date.UTC(
    parseInt(map.year, 10),
    parseInt(map.month, 10) - 1,
    parseInt(map.day, 10),
    parseInt(map.hour === '24' ? '0' : map.hour, 10),
    parseInt(map.minute, 10),
    parseInt(map.second, 10),
  )
  return Math.round((asUTC - date.getTime()) / MINUTE_MS)
}

function localWallClock(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const hour = map.hour === '24' ? '00' : map.hour
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}`
}

export function dstTraps(
  _kind: ScheduleKind,
  _expr: string,
  timezone: string,
  fromISO: string,
  days: number,
): DstTrap[] {
  const tz = timezone || 'UTC'
  const fromMs = Date.parse(fromISO)
  const start = Number.isNaN(fromMs) ? Date.now() : fromMs
  const span = (days > 0 ? days : 7) * DAY_MS
  const end = start + span

  const traps: DstTrap[] = []
  let cursor = start
  let prevOffset = tzOffsetMinutes(new Date(cursor), tz)
  cursor += HOUR_MS

  while (cursor <= end) {
    const here = new Date(cursor)
    const offset = tzOffsetMinutes(here, tz)
    if (offset !== prevOffset) {
      const delta = offset - prevOffset // minutes
      const atUtc = here.toISOString()
      const atLocal = localWallClock(here, tz)
      if (delta > 0) {
        // Clock sprang forward: a band of local wall-clock times never occurs.
        traps.push({ type: 'skip', atLocal, atUtc })
      } else {
        // Clock fell back: a band of local wall-clock times occurs twice.
        traps.push({ type: 'ambiguous', atLocal, atUtc })
        traps.push({ type: 'double_fire', atLocal, atUtc })
      }
    }
    prevOffset = offset
    cursor += HOUR_MS
  }
  return traps
}

// ----------------------------------------------------------------------------
// coverageGaps — given desired daily coverage windows (local minutes-of-day)
// and the jobs, report windows that have no scheduled firing landing in them
// across the horizon.
// ----------------------------------------------------------------------------

export function coverageGaps(
  windows: CoverageWindow[],
  jobs: Job[],
  opts: { horizonDays: number },
): CoverageGap[] {
  const horizonDays = opts.horizonDays > 0 ? opts.horizonDays : 7
  const fromISO = new Date().toISOString()
  const fromMs = Date.parse(fromISO)
  const endMs = fromMs + horizonDays * DAY_MS

  // Collect every firing's minute-of-day (UTC) across all jobs.
  const firingMinutesOfDay: number[] = []
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone, fromISO, 5000)
    for (const iso of firings) {
      const ms = Date.parse(iso)
      if (ms > endMs) break
      const d = new Date(ms)
      firingMinutesOfDay.push(d.getUTCHours() * 60 + d.getUTCMinutes())
    }
  }

  const gaps: CoverageGap[] = []
  for (const w of windows) {
    const covered = firingMinutesOfDay.some((mod) => mod >= w.startMinute && mod < w.endMinute)
    if (!covered) {
      const startH = String(Math.floor(w.startMinute / 60)).padStart(2, '0')
      const startM = String(w.startMinute % 60).padStart(2, '0')
      const endH = String(Math.floor(w.endMinute / 60)).padStart(2, '0')
      const endM = String(w.endMinute % 60).padStart(2, '0')
      gaps.push({
        windowStart: `${startH}:${startM}`,
        windowEnd: `${endH}:${endM}`,
        reason: w.label
          ? `No job fires during "${w.label}" window`
          : 'No job fires during this window',
      })
    }
  }
  return gaps
}

// ----------------------------------------------------------------------------
// autoSpread — for jobs piling into the same minute beyond `threshold`,
// suggest a deterministically staggered cron expression to spread the load.
// ----------------------------------------------------------------------------

export function autoSpread(
  jobs: Job[],
  opts: { threshold: number },
): SpreadSuggestion[] {
  const threshold = opts.threshold > 0 ? opts.threshold : 2
  const collisions = computeCollisions(jobs, { horizonDays: 1, threshold })

  const suggestions: SpreadSuggestion[] = []
  const handled = new Set<string>()

  for (const col of collisions) {
    // Keep the first job in the colliding minute as-is; stagger the rest.
    const ids = col.jobIds
    for (let i = 1; i < ids.length; i++) {
      const jobId = ids[i]
      if (handled.has(jobId)) continue
      const job = jobs.find((j) => j.id === jobId)
      if (!job) continue
      // Deterministic offset: derive minutes from the job's position so each
      // colliding job lands on a distinct minute within the hour.
      const offset = (i * 7) % 60
      let suggestedExpr: string
      if (job.kind === 'cron') {
        const fields = job.expr.trim().split(/\s+/)
        if (fields.length >= 5) {
          fields[0] = String(offset)
          suggestedExpr = fields.join(' ')
        } else {
          suggestedExpr = `${offset} * * * *`
        }
      } else if (job.kind === 'rate') {
        // Convert a rate to a cron that fires at a staggered minute hourly.
        suggestedExpr = `${offset} * * * *`
      } else {
        // one-off: nothing to spread.
        continue
      }
      suggestions.push({
        jobId,
        suggestedExpr,
        reason: `Staggered to minute ${offset} to relieve a collision at ${col.windowStart}${col.resourceId ? ` on resource ${col.resourceId}` : ''}`,
      })
      handled.add(jobId)
    }
  }
  return suggestions
}
