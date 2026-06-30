import Link from 'next/link'

const features = [
  {
    title: 'Party Register',
    body: 'Track every customer, supplier, intermediary, and end user with aliases, identifiers, tags, and a full status lifecycle: unscreened, clear, flagged, blocked, needs re-screen.',
  },
  {
    title: 'Versioned Restricted-Party Lists',
    body: 'Maintain OFAC SDN, BIS Entity List, EU and UN Consolidated, plus custom internal watchlists. Every refresh is an immutable, content-hashed, dated version.',
  },
  {
    title: 'Deterministic Fuzzy Matching',
    body: 'Reproducible, explainable name matching with Jaro-Winkler scoring, alias awareness, and country corroboration. No opaque ML scores an auditor cannot defend.',
  },
  {
    title: 'Structured Adjudication',
    body: 'Every candidate match is Cleared, Blocked, or Escalated with a required reason and named reviewer. Four-eyes escalation. Re-adjudication never destroys history.',
  },
  {
    title: 'Re-screen Cadence',
    body: 'Lists change weekly. Per-workspace and per-party schedules, automatic re-screen on record change or new list version, and an overdue queue.',
  },
  {
    title: 'Order & Transaction Gate',
    body: 'Orders are blocked while any referenced party is unresolved. Release with required justification and reviewer. Gate recomputes on every status change.',
  },
  {
    title: 'Embargo & End-Use Flags',
    body: 'Embargoed-destination registry and prohibited end-use rules (military, WMD, nuclear) that block the gate before anything ships.',
  },
  {
    title: 'Immutable Decision Ledger',
    body: 'Append-only, hash-chained record of every screening, adjudication, override, and status change. Tampering is detectable; corrections are new entries.',
  },
  {
    title: 'One-Click Audit Export',
    body: 'Defensible bundles with parties, screenings, matches, overrides, the exact list versions used, and the hash chain for verification.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-lg font-bold">
          <span className="inline-block h-6 w-6 rounded bg-amber-500" />
          ExportScreening<span className="text-amber-400">Ledger</span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-zinc-300 hover:text-zinc-100">
            Pricing
          </Link>
          <Link href="/auth/sign-in" className="text-sm text-zinc-300 hover:text-zinc-100">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
          Deterministic. Explainable. Defensible.
        </span>
        <h1 className="mt-6 text-4xl font-black tracking-tight sm:text-5xl">
          Continuous restricted-party screening with an{' '}
          <span className="text-amber-400">immutable decision-of-record</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
          ExportScreeningLedger screens every party against current OFAC, BIS, EU, and UN lists, forces each match
          through a structured adjudication workflow, gates orders on unresolved parties, and writes every action to a
          hash-chained ledger that survives an audit.
        </p>
        <div className="mt-9 flex items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
          >
            Start screening free
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Problem */}
      <section className="border-y border-zinc-800 bg-zinc-900/30">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl font-bold">Spreadsheets do not survive an enforcement inquiry</h2>
          <p className="mt-4 max-w-3xl text-zinc-400">
            OFAC, BIS, and EU screening is continuous, list-driven, and personally liability-bearing for the compliance
            officer. Yet most mid-market exporters run it in spreadsheets with no defensible audit trail, no re-screen
            cadence, no transaction gate, no immutability, and no recorded reasoning. When an audit hits, the team
            cannot reconstruct what it knew and when.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['No audit trail', 'Who screened whom, against which list version, on what date, and why.'],
              ['No cadence', 'A party cleared last quarter may be on this week’s SDN list.'],
              ['No gate', 'Orders ship to parties that were never resolved.'],
              ['No immutability', 'An editable spreadsheet has no evidentiary value.'],
            ].map(([t, b]) => (
              <div key={t} className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
                <h3 className="font-semibold text-amber-400">{t}</h3>
                <p className="mt-2 text-sm text-zinc-400">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold">Everything an export-compliance program needs</h2>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
              <h3 className="text-base font-semibold text-zinc-100">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-zinc-800 bg-zinc-900/30">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="text-3xl font-bold">A defensible record, from first sign-in</h2>
          <p className="mx-auto mt-4 max-w-xl text-zinc-400">
            A built-in synthetic seeder generates parties, list versions, near-match decoys, orders, and screening
            history so you can explore the full workflow immediately.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              href="/auth/sign-up"
              className="rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
            >
              Get Started
            </Link>
            <Link
              href="/pricing"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-8 text-center text-sm text-zinc-600">
        <p>ExportScreeningLedger — continuous restricted-party screening and decision-of-record.</p>
      </footer>
    </main>
  )
}
