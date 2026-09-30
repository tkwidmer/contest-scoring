import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { friendly } from '../lib/errors'
import { fmt } from '../lib/scoreCells'
import { ContestHeader } from '../components/ContestHeader'
import { buttonQuiet, card } from '../components/ui'

// The audit trail (producers only, by RLS): every score entered, changed or cleared, and every sheet submitted or
// unlocked, newest first. Plus a CSV of every score for the organization's records.
type Contest = { id: string; name: string; status: string; event_id: string; events: { name: string } | null }
type Entry = { at: string; by: string | null; text: string; reason?: string | null; change: boolean }

export function ContestHistory() {
  const { contestId = '' } = useParams()
  const [contest, setContest] = useState<Contest | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [csv, setCsv] = useState<string[][]>([])
  const [changesOnly, setChangesOnly] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [c, cats, cs, js, sa, sh, sc] = await Promise.all([
      supabase.from('contests').select('id, name, status, event_id, events(name)').eq('id', contestId).maybeSingle(),
      supabase.from('categories').select('id, name, components(id, name)').eq('contest_id', contestId).order('sort').order('sort', { referencedTable: 'components' }),
      supabase.from('contestants').select('id, display_name, number').eq('contest_id', contestId).order('sort'),
      supabase.from('judges').select('id, name, user_id').eq('contest_id', contestId).order('sort'),
      supabase.from('score_audit').select('judge_id, contestant_id, component_id, op, old_value, new_value, changed_by, changed_at').eq('contest_id', contestId).order('changed_at', { ascending: false }).limit(2000),
      supabase.from('sheet_audit').select('judge_id, contestant_id, category_id, action, reason, changed_by, changed_at').eq('contest_id', contestId).order('changed_at', { ascending: false }),
      supabase.from('scores').select('judge_id, contestant_id, component_id, value').eq('contest_id', contestId),
    ])
    const failed = c.error ?? cats.error ?? cs.error ?? js.error ?? sa.error ?? sh.error ?? sc.error
    if (failed) return setError(friendly(failed))
    if (!c.data) return setError("This contest doesn't exist, or you're not a member of its organization.")
    setContest(c.data)

    // Names. Changes are made by org members (profiles) or by judges on their own phones (their judge seat).
    const people = new Map((cs.data ?? []).map(p => [p.id, p.number != null ? `${p.number} · ${p.display_name}` : p.display_name]))
    const judge = new Map((js.data ?? []).map(j => [j.id, j.name]))
    const byUser = new Map((js.data ?? []).filter(j => j.user_id).map(j => [j.user_id!, `${j.name} (judge)`]))
    const ids = [...new Set([...(sa.data ?? []), ...(sh.data ?? [])].map(x => x.changed_by).filter((x): x is string => !!x && !byUser.has(x)))]
    const profiles = ids.length ? (await supabase.from('profiles').select('id, display_name').in('id', ids)).data ?? [] : []
    const who = (id: string | null) => (id && (byUser.get(id) ?? profiles.find(p => p.id === id)?.display_name)) || null
    const catOf = new Map((cats.data ?? []).map(x => [x.id, x.name]))
    const comp = new Map((cats.data ?? []).flatMap(x => x.components.map(k => [k.id, { cat: x.name, name: k.name }] as const)))
    const part = (id: string) => { const k = comp.get(id); return k ? (k.name === k.cat ? k.cat : `${k.cat} · ${k.name}`) : 'a deleted component' }
    const sheet = (j: string | null) => (j ? `${judge.get(j) ?? 'a judge'}'s` : 'the producer-entered')

    setEntries([
      ...(sa.data ?? []).map(a => ({
        at: a.changed_at, by: who(a.changed_by), change: a.op !== 'insert',
        text: a.op === 'insert' ? `Entered ${fmt(a.new_value!)} on ${sheet(a.judge_id)} ${part(a.component_id)} for ${people.get(a.contestant_id)}`
          : a.op === 'update' ? `Changed ${sheet(a.judge_id)} ${part(a.component_id)} for ${people.get(a.contestant_id)}: ${fmt(a.old_value!)} → ${fmt(a.new_value!)}`
          : `Cleared ${sheet(a.judge_id)} ${part(a.component_id)} for ${people.get(a.contestant_id)} (was ${fmt(a.old_value!)})`,
      })),
      ...(sh.data ?? []).map(s => ({
        at: s.changed_at, by: who(s.changed_by), change: s.action === 'unlock', reason: s.reason,
        text: `${s.action === 'submit' ? 'Submitted' : 'Unlocked'} ${judge.get(s.judge_id)}'s ${catOf.get(s.category_id)} sheet for ${people.get(s.contestant_id)}`,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at)))

    setCsv([['Contestant', 'Judge', 'Category', 'Component', 'Score'],
      ...(sc.data ?? []).map(s => { const k = comp.get(s.component_id)
        return [people.get(s.contestant_id) ?? '', s.judge_id ? judge.get(s.judge_id) ?? '' : 'Producer', k?.cat ?? '', k?.name ?? '', fmt(s.value)] })
        .sort((a, b) => a.join('|').localeCompare(b.join('|')))])
  }, [contestId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the awaits
  useEffect(() => { load() }, [load])

  if (!contest) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>

  const download = () => {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
    const url = URL.createObjectURL(new Blob([csv.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }))
    Object.assign(document.createElement('a'), { href: url, download: `${contest.name} scores.csv` }).click()
    URL.revokeObjectURL(url)
  }
  const shown = entries.filter(e => !changesOnly || e.change)

  return (
    <div className="grid gap-6">
      <ContestHeader contest={contest} />
      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={changesOnly} onChange={e => setChangesOnly(e.target.checked)} /> Only changes and unlocks
        </label>
        <span className="flex-1" />
        <button className={buttonQuiet} onClick={() => window.print()}>Print history</button>
        <button className={buttonQuiet} disabled={csv.length < 2} onClick={download}>Download all scores (CSV)</button>
      </div>
      <p className="max-w-prose text-sm text-muted print:hidden">
        Every score entered, changed or cleared, and every sheet submitted or unlocked, newest first. Nobody can edit or delete this history.
      </p>
      {shown.length === 0 ? <p className="text-muted">Nothing yet.</p> : (
        <ol className={`${card} divide-y divide-rule text-sm`}>
          {shown.map((e, i) => (
            <li key={i} className="grid gap-0.5 px-3 py-2 sm:grid-cols-[11rem_1fr]">
              <span className="font-mono text-xs text-muted">{new Date(e.at).toLocaleString()}</span>
              <span>{e.text}{e.by && <span className="text-muted"> · {e.by}</span>}
                {e.reason && <span className="block text-muted">Reason: {e.reason}</span>}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
