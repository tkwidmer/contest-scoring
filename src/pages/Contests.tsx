import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { card, input } from '../components/ui'
import { PublicFooter, PublicHeader } from '../components/PublicHeader'
import type { Snapshot } from './Results'

// Public index of every contest with published results, newest event first; each links to its results page.
type Row = { contest_id: string; snapshot: Snapshot & { date?: string | null } }

const day = (iso?: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '')

export function Contests() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    supabase.from('published_results').select('contest_id, snapshot')
      .then(({ data }) => setRows((data ?? []).map(r => r as unknown as Row)
        .sort((a, b) => (b.snapshot.date ?? '').localeCompare(a.snapshot.date ?? '') || a.snapshot.contest.localeCompare(b.snapshot.contest))))
  }, [])

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = (rows ?? []).filter(r => {
    const text = [r.snapshot.contest, r.snapshot.event, r.snapshot.org, r.snapshot.winner?.name].join(' ').toLowerCase()
    return words.every(w => text.includes(w))
  })

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto grid max-w-4xl gap-6 px-4 py-10">
        <div className="grid gap-1">
          <p className="text-sm font-semibold uppercase tracking-wider text-heart">Contests</p>
          <h1 className="font-display text-4xl font-extrabold uppercase sm:text-5xl">Past results</h1>
          <p className="text-muted">Every contest scored on Tallymaster.top whose results have been published.</p>
        </div>
        <input type="search" aria-label="Search contests" placeholder="Search by contest, event, organization or winner" className={input}
          value={q} onChange={e => setQ(e.target.value)} />
        {rows === null ? <p className="text-muted">Loading…</p> : shown.length === 0
          ? <p className="text-muted">{rows.length ? 'No contests match your search.' : 'No results have been published yet.'}</p>
          : (
            <ul className={`${card} divide-y divide-rule`}>
              {shown.map(r => (
                <li key={r.contest_id}>
                  <Link to={`/r/${r.contest_id}`} className="grid gap-1 px-4 py-3 hover:bg-bg sm:grid-cols-[8rem_1fr_auto] sm:items-baseline sm:gap-4">
                    <span className="font-mono text-sm text-muted">{day(r.snapshot.date)}</span>
                    <span><span className="font-medium">{r.snapshot.contest}</span>
                      <span className="block text-sm text-muted">{[r.snapshot.event, r.snapshot.org].filter(Boolean).join(' · ')}</span></span>
                    <span className="text-sm">{r.snapshot.winner ? <>Winner: <strong>{r.snapshot.winner.name}</strong></> : <span className="text-muted">No title awarded</span>}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </main>
      <PublicFooter />
    </div>
  )
}
