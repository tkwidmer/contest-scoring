import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { card } from '../components/ui'
import { PublicFooter, PublicHeader } from '../components/PublicHeader'
import type { Snapshot } from './Results'

// Public page listing every result an organization has published, newest first. No sign-in.
type Row = { contest_id: string; published_at: string; snapshot: Snapshot }

export function OrgResults() {
  const { orgId = '' } = useParams()
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    supabase.from('published_results').select('contest_id, published_at, snapshot').eq('org_id', orgId).order('published_at', { ascending: false })
      .then(({ data }) => setRows((data ?? []).map(r => ({ ...r, snapshot: r.snapshot as unknown as Snapshot }))))
  }, [orgId])

  const org = rows?.[0]?.snapshot.org
  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto grid max-w-4xl gap-6 px-4 py-10">
        {rows === null ? <p className="text-muted">Loading…</p> : rows.length === 0 ? <p className="text-muted">No published results yet.</p> : <>
          <div className="grid gap-1">
            <p className="text-sm text-muted">Official results</p>
            <h1 className="font-display text-4xl font-extrabold uppercase sm:text-5xl">{org}</h1>
          </div>
          <ul className="grid gap-2">
            {rows.map(r => (
              <li key={r.contest_id}>
                <Link to={`/r/${r.contest_id}`} className={`${card} flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:border-accent`}>
                  <span><span className="font-medium">{r.snapshot.contest}</span> <span className="text-sm text-muted">{r.snapshot.event}</span></span>
                  <span className="text-sm">{r.snapshot.winner ? <>Winner: <strong>{r.snapshot.winner.name}</strong></> : <span className="text-muted">No title awarded</span>}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>}
      </main>
      <PublicFooter />
    </div>
  )
}
