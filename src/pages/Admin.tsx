import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendly } from '../lib/errors'
import { buttonQuiet, button, card, h1 } from '../components/ui'
import type { Database } from '../lib/database.types'

type Row = Database['public']['Functions']['event_approvals']['Returns'][number]

// Platform admins approve events once the $100 fee is paid. The RPC refuses everyone else.
export function Admin() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('event_approvals')
    if (error) return setError(friendly(error))
    setRows(data)
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the await
  useEffect(() => { load() }, [load])

  const approve = async (id: string, approved: boolean) => {
    if (!approved && !window.confirm('Revoke approval? Contests already scoring carry on; new ones can’t start.')) return
    const { error } = await supabase.rpc('set_event_approval', { p_event: id, p_approved: approved })
    if (error) setError(friendly(error)); else load()
  }
  const date = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '')

  return (
    <div className="grid gap-6">
      <h1 className={h1}>Event approvals</h1>
      <p className="max-w-prose text-muted">Approve an event once its $100 fee is paid. Requests come first; email the requester how to pay.</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {rows && (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr className="border-b border-rule">
                <th className="px-3 py-2 font-normal">Event</th><th className="px-3 font-normal">Organization</th>
                <th className="px-3 font-normal">Contests</th><th className="px-3 font-normal">Requested</th>
                <th className="px-3 font-normal">Status</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.event_id} className="border-b border-rule last:border-0">
                  <td className="px-3 py-2">{r.event_name}
                    <input type="date" aria-label={`${r.event_name} date`} defaultValue={r.starts_on ?? ''} key={r.starts_on ?? ''}
                      className="block rounded border border-rule bg-surface px-1 text-xs text-muted"
                      onBlur={async e => {
                        if (!e.target.value || e.target.value === r.starts_on) return
                        const { error } = await supabase.rpc('set_event_date', { p_event: r.event_id, p_date: e.target.value })
                        if (error) setError(friendly(error)); else load()
                      }} /></td>
                  <td className="px-3">{r.org_name}</td>
                  <td className="px-3 font-mono">{r.contests}</td>
                  <td className="px-3">{date(r.requested_at)}{r.requested_by_email && <a href={`mailto:${r.requested_by_email}`} className="block text-xs text-accent">{r.requested_by_email}</a>}</td>
                  <td className="px-3">{r.approved_at ? `Approved ${date(r.approved_at)}` : r.requested_at ? 'Awaiting payment' : 'Not requested'}</td>
                  <td className="px-3 py-2 text-right">
                    {r.approved_at
                      ? <button className={buttonQuiet} onClick={() => approve(r.event_id, false)}>Revoke</button>
                      : <button className={button} onClick={() => approve(r.event_id, true)}>Approve</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
