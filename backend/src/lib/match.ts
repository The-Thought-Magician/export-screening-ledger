// ----------------------------------------------------------------------------
// match.ts — the deterministic name-matching engine.
//
// Pure functions, no DB / IO. Given a party name (+ aliases) and a candidate
// list-entry name (+ aliases), produce a stable similarity score in [0,1] with
// an explainable breakdown. Used by screenings.ts to create screening_matches.
// ----------------------------------------------------------------------------

export interface ScoreWeights {
  // Relative importance of each signal. Normalized internally, so absolute
  // magnitudes don't matter, only ratios.
  nameSimilarity?: number
  tokenOverlap?: number
  country?: number
}

export interface ScoreBreakdown {
  nameSimilarity: number
  tokenOverlap: number
  countryMatch: number
  bestPartyName: string
  bestEntryName: string
  weights: { nameSimilarity: number; tokenOverlap: number; country: number }
}

export interface ScoreResult {
  score: number
  breakdown: ScoreBreakdown
}

const DEFAULT_WEIGHTS = { nameSimilarity: 0.6, tokenOverlap: 0.3, country: 0.1 }

/**
 * Normalize a name for comparison: lowercase, strip punctuation, collapse
 * whitespace, drop common corporate suffixes so "Acme Ltd." == "ACME LTD".
 */
export function normalize(s: string): string {
  if (!s) return ''
  let out = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const suffixes = [
    'incorporated', 'inc', 'corporation', 'corp', 'limited', 'ltd', 'llc',
    'plc', 'gmbh', 'co', 'company', 'sa', 'ag', 'bv', 'srl', 'spa', 'pte',
    'pvt', 'private', 'group', 'holdings', 'trading',
  ]
  const tokens = out.split(' ').filter((t) => t && !suffixes.includes(t))
  return tokens.join(' ')
}

/**
 * Jaro-Winkler similarity in [0,1]. Deterministic, classic implementation.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0

  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatches = new Array<boolean>(a.length).fill(false)
  const bMatches = new Array<boolean>(b.length).fill(false)

  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, b.length)
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue
      if (a[i] !== b[j]) continue
      aMatches[i] = true
      bMatches[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0

  let transpositions = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue
    while (!bMatches[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  transpositions = transpositions / 2

  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3

  // Winkler boost for a common prefix up to 4 chars.
  let prefix = 0
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++
    else break
  }
  return jaro + prefix * 0.1 * (1 - jaro)
}

function tokenOverlap(a: string, b: string): number {
  const aTok = new Set(a.split(' ').filter(Boolean))
  const bTok = new Set(b.split(' ').filter(Boolean))
  if (aTok.size === 0 || bTok.size === 0) return 0
  let inter = 0
  for (const t of aTok) if (bTok.has(t)) inter++
  const union = aTok.size + bTok.size - inter
  return union === 0 ? 0 : inter / union
}

export interface MatchSubject {
  name: string
  aliases?: string[]
  country?: string | null
}

/**
 * Score a party against a list entry. Considers all (party-name x entry-name)
 * pairings including aliases, takes the best, and folds in token overlap and
 * a country signal. Returns a stable score in [0,1] with an explainable
 * breakdown stored on screening_matches.score_breakdown.
 */
export function scoreMatch(
  party: MatchSubject,
  entry: MatchSubject,
  weights?: ScoreWeights,
): ScoreResult {
  const w = {
    nameSimilarity: weights?.nameSimilarity ?? DEFAULT_WEIGHTS.nameSimilarity,
    tokenOverlap: weights?.tokenOverlap ?? DEFAULT_WEIGHTS.tokenOverlap,
    country: weights?.country ?? DEFAULT_WEIGHTS.country,
  }
  const total = w.nameSimilarity + w.tokenOverlap + w.country || 1

  const partyNames = [party.name, ...(party.aliases ?? [])].filter(Boolean)
  const entryNames = [entry.name, ...(entry.aliases ?? [])].filter(Boolean)

  let bestSim = 0
  let bestOverlap = 0
  let bestPartyName = party.name
  let bestEntryName = entry.name

  for (const pn of partyNames) {
    const np = normalize(pn)
    for (const en of entryNames) {
      const ne = normalize(en)
      const sim = jaroWinkler(np, ne)
      const overlap = tokenOverlap(np, ne)
      // Combined signal for picking the best pairing.
      const combined = sim * 0.7 + overlap * 0.3
      const bestCombined = bestSim * 0.7 + bestOverlap * 0.3
      if (combined > bestCombined) {
        bestSim = sim
        bestOverlap = overlap
        bestPartyName = pn
        bestEntryName = en
      }
    }
  }

  let countryMatch = 0
  if (party.country && entry.country) {
    countryMatch =
      normalize(party.country) === normalize(entry.country) ? 1 : 0
  }

  const score =
    (bestSim * w.nameSimilarity + bestOverlap * w.tokenOverlap + countryMatch * w.country) /
    total

  return {
    score: Math.max(0, Math.min(1, score)),
    breakdown: {
      nameSimilarity: bestSim,
      tokenOverlap: bestOverlap,
      countryMatch,
      bestPartyName,
      bestEntryName,
      weights: w,
    },
  }
}
