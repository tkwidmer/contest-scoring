import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { card } from '../components/ui'
import { PublicFooter, PublicHeader } from '../components/PublicHeader'

// Public results at /r/:contest, no sign-in. Reads only the published snapshot (publish_contest), never live tables.
export type Snapshot = {
  org?: string; contest: string; event: string
  prelim?: { rank: number; name: string; number?: number; finalist?: boolean; total?: number; pct?: number }[]
  winner: { name: string; reason: string | null } | null
  maxPossible?: number; thresholdPct: number | null
  categories?: string[]
  standings: { rank: number; name: string; number?: number; total?: number; pct?: number; categoryTotals?: number[] }[]
}

const fmt = (n: number) => Number(n.toFixed(2)).toString()

export function Results() {
  const { contestId = '' } = useParams()
  const [data, setData] = useState<{ snapshot: Snapshot; published_at: string; org_id: string } | null | undefined>(undefined)

  useEffect(() => {
    supabase.from('published_results').select('snapshot, published_at, org_id').eq('contest_id', contestId).maybeSingle()
      .then(({ data }) => setData(data ? { snapshot: data.snapshot as unknown as Snapshot, published_at: data.published_at, org_id: data.org_id } : null))
  }, [contestId])

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-10">
        {data === undefined ? <p className="text-muted">Loading…</p>
          : data === null ? <p className="text-muted">These results aren't published.</p>
          : <>
              <ResultsView snapshot={data.snapshot} publishedAt={data.published_at} />
              {data.snapshot.org && <Link to={`/org/${data.org_id}`} className="text-sm text-accent">More results from {data.snapshot.org} →</Link>}
            </>}
      </main>
      <PublicFooter />
    </div>
  )
}

export function ResultsView({ snapshot: s, publishedAt }: { snapshot: Snapshot; publishedAt: string }) {
  const full = !!s.categories
  return (<>
    <div className="grid gap-1">
      <p className="text-sm text-muted">{s.event}</p>
      <h1 className="font-display text-4xl font-extrabold uppercase sm:text-5xl">{s.contest}</h1>
      <p className="text-sm text-muted">Official results · published {new Date(publishedAt).toLocaleDateString(undefined, { dateStyle: 'long' })}</p>
    </div>
    <div className={`${card} border-l-4 border-l-heart px-5 py-4 text-xl`}>
      {s.winner
        ? <p><span className="text-muted">Winner: </span><strong>{s.winner.name}</strong>{s.winner.reason && <span className="text-base text-muted"> · {s.winner.reason}</span>}</p>
        : <p><strong>No title awarded.</strong>{s.thresholdPct != null && <span className="text-base text-muted"> No contestant reached the {s.thresholdPct}% minimum.</span>}</p>}
    </div>
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr className="border-b border-rule">
            <th className="px-3 py-2 font-normal">Rank</th><th className="px-3 font-normal">Contestant</th>
            {full && s.categories!.map(c => <th key={c} className="px-3 text-right font-normal">{c}</th>)}
            {full && <><th className="px-3 text-right font-normal">Total</th><th className="px-3 text-right font-normal">%</th></>}
          </tr>
        </thead>
        <tbody>
          {s.standings.map(r => (
            <tr key={`${r.rank}${r.name}`} className="border-b border-rule last:border-0">
              <td className="px-3 py-2 font-mono">{r.rank}</td>
              <td className="whitespace-nowrap px-3">{r.number != null && <span className="font-mono text-muted">{r.number} · </span>}{r.name}</td>
              {full && r.categoryTotals?.map((t, i) => <td key={i} className="px-3 text-right font-mono">{fmt(t)}</td>)}
              {full && <><td className="px-3 text-right font-mono font-semibold">{fmt(r.total ?? 0)}</td>
                <td className="px-3 text-right font-mono">{((r.pct ?? 0) * 100).toFixed(1)}%</td></>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {full && s.maxPossible != null && <p className="text-xs text-muted">Out of {fmt(s.maxPossible)} points possible. Scored with Tallymaster.top.</p>}
    {s.prelim && (
      <section className="grid gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Preliminaries</h2>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="text-left text-muted"><tr className="border-b border-rule">
              <th className="px-3 py-2 font-normal">Rank</th><th className="px-3 font-normal">Contestant</th>
              {full && <><th className="px-3 text-right font-normal">Total</th><th className="px-3 text-right font-normal">%</th></>}</tr></thead>
            <tbody>
              {s.prelim.map(r => (
                <tr key={`${r.rank}${r.name}`} className="border-b border-rule last:border-0">
                  <td className="px-3 py-2 font-mono">{r.rank}</td>
                  <td className="whitespace-nowrap px-3">{r.number != null && <span className="font-mono text-muted">{r.number} · </span>}{r.name}
                    {r.finalist && <span className="ml-2 font-mono text-xs text-accent">finalist</span>}</td>
                  {full && <><td className="px-3 text-right font-mono">{fmt(r.total ?? 0)}</td><td className="px-3 text-right font-mono">{((r.pct ?? 0) * 100).toFixed(1)}%</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )}
  </>)
}
