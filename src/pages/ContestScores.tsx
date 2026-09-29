import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { friendly } from '../lib/errors'
import { cellKey, createSaveQueue, type Cell, type QueueState, type SendResult } from '../lib/saveQueue'
import type { TablesInsert } from '../lib/database.types'
import { ContestHeader } from '../components/ContestHeader'
import { card, h2, iconButton, input } from '../components/ui'

type Component = { id: string; name: string; min_points: number; max_points: number; step: number }
type Category = { id: string; name: string; components: Component[] }
type Person = { id: string; name: string }
type Contest = { id: string; name: string; status: string; event_id: string; events: { name: string } | null }
type View = 'sheet' | 'category' | 'contestant'

const fmt = (n: number) => Number(n.toFixed(2)).toString()

async function sendCell(c: Cell): Promise<SendResult> {
  const match = { judge_id: c.judge_id, contestant_id: c.contestant_id, component_id: c.component_id }
  const { error } = c.value == null
    ? await supabase.from('scores').delete().match(match)
    // contest_id and entered_by are filled in by the database trigger.
    : await supabase.from('scores').upsert({ ...match, value: c.value } as TablesInsert<'scores'>, { onConflict: 'judge_id,contestant_id,component_id' })
  if (!error) return { ok: true }
  // Database/API rejections won't succeed on retry; anything else (no code) is the network.
  const rejected = /^(P0001|2\d{4}|42\d{3}|PGRST)/.test(error.code ?? '')
  return { ok: false, retry: !rejected, message: friendly(error) }
}

// Client-side check mirrors the database trigger so typos are caught before they're queued.
function problem(v: number, k: Component): string | null {
  if (Number.isNaN(v)) return 'Not a number'
  if (v < k.min_points || v > k.max_points || Math.round((v - k.min_points) / k.step * 1e6) % 1e6 !== 0) {
    return `Must be ${fmt(k.min_points)}–${fmt(k.max_points)} in steps of ${fmt(k.step)}`
  }
  return null
}

export function ContestScores() {
  const { contestId = '' } = useParams()
  const [contest, setContest] = useState<Contest | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [contestants, setContestants] = useState<Person[]>([])
  const [judges, setJudges] = useState<Person[]>([])
  const [recused, setRecused] = useState<Set<string>>(new Set())
  const [values, setValues] = useState<Map<string, number | null>>(new Map())
  const [error, setError] = useState('')
  const [view, setView] = useState<View>('sheet')
  const [judgeId, setJudgeId] = useState('')
  const [contestantId, setContestantId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const queue = useMemo(() => createSaveQueue({ storageKey: `scores:${contestId}`, send: sendCell }), [contestId])
  const [sync, setSync] = useState<QueueState>({ pending: 0, failing: new Map(), offline: false })

  const load = useCallback(async () => {
    const [c, cats, cs, js, rs, sc] = await Promise.all([
      supabase.from('contests').select('id, name, status, event_id, events(name)').eq('id', contestId).maybeSingle(),
      supabase.from('categories').select('id, name, components(id, name, min_points, max_points, step)')
        .eq('contest_id', contestId).order('sort').order('sort', { referencedTable: 'components' }),
      supabase.from('contestants').select('id, display_name, number').eq('contest_id', contestId).eq('withdrawn', false).order('sort'),
      supabase.from('judges').select('id, name').eq('contest_id', contestId).order('sort'),
      supabase.from('recusals').select('judge_id, contestant_id, judges!inner(contest_id)').eq('judges.contest_id', contestId),
      supabase.from('scores').select('judge_id, contestant_id, component_id, value').eq('contest_id', contestId),
    ])
    const failed = c.error ?? cats.error ?? cs.error ?? js.error ?? rs.error ?? sc.error
    if (failed) return setError(friendly(failed))
    if (!c.data) return setError("This contest doesn't exist, or you're not a member of its organization.")
    setContest(c.data)
    setCategories(cats.data ?? [])
    setContestants((cs.data ?? []).map(x => ({ id: x.id, name: x.number != null ? `${x.number} · ${x.display_name}` : x.display_name })))
    setJudges(js.data ?? [])
    setRecused(new Set((rs.data ?? []).map(r => `${r.judge_id}|${r.contestant_id}`)))
    // Unsaved local edits win over what the server has.
    setValues(new Map([...(sc.data ?? []).map(s => [cellKey(s), s.value] as const), ...queue.pendingValues()]))
    setJudgeId(id => id || js.data?.[0]?.id || '')
    setContestantId(id => id || cs.data?.[0]?.id || '')
    setCategoryId(id => id || cats.data?.[0]?.id || '')
  }, [contestId, queue])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the awaits
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const unsubscribe = queue.subscribe(setSync)
    const retry = () => queue.flush()
    const warn = (e: BeforeUnloadEvent) => { if (queue.pendingValues().size) e.preventDefault() }
    window.addEventListener('online', retry)
    window.addEventListener('beforeunload', warn)
    queue.flush() // anything left from a previous visit
    return () => { unsubscribe(); queue.dispose(); window.removeEventListener('online', retry); window.removeEventListener('beforeunload', warn) }
  }, [queue])

  if (!contest) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>

  const editable = contest.status === 'scoring'
  const components = categories.flatMap(c => c.components)
  const commit = (cell: Cell) => {
    setValues(v => new Map(v).set(cellKey(cell), cell.value))
    queue.set(cell)
  }
  const cellProps = (judge_id: string, contestant_id: string, k: Component, label: string) => {
    const key = cellKey({ judge_id, contestant_id, component_id: k.id })
    return {
      k, label, editable, recused: recused.has(`${judge_id}|${contestant_id}`),
      value: values.get(key) ?? null, serverError: sync.failing.get(key),
      onCommit: (value: number | null) => commit({ judge_id, contestant_id, component_id: k.id, value }),
    }
  }
  const sheetTotal = (judge_id: string, contestant_id: string, ks: Component[]) =>
    ks.reduce((s, k) => s + (values.get(cellKey({ judge_id, contestant_id, component_id: k.id })) ?? 0), 0)
  const nameOf = (list: Person[], id: string) => list.find(x => x.id === id)?.name ?? ''

  if (components.length === 0 || contestants.length === 0 || judges.length === 0) {
    return <div className="grid gap-6"><ContestHeader contest={contest} />
      <p className="text-muted">Add a scoresheet, contestants and judges before entering scores.</p></div>
  }

  return (
    <div className="grid gap-6">
      <ContestHeader contest={contest} />
      {contest.status === 'draft' && (
        <p className={`${card} px-4 py-3`}>Scoring hasn't started yet. Start it from <Link to={`/c/${contest.id}/setup`} className="text-accent underline">Setup</Link> once the scoresheet and people are ready.</p>
      )}
      {(contest.status === 'finalized' || contest.status === 'published') && (
        <p className={`${card} px-4 py-3`}>🔒 This contest is {contest.status}. Scores are read-only.</p>
      )}
      {error && <p role="alert" className="rounded border border-danger px-4 py-3 text-danger">{error}</p>}
      {sync.failing.size > 0 && (
        <p role="alert" className="rounded border border-danger px-4 py-3 text-danger">
          {sync.failing.size} score{sync.failing.size > 1 ? 's weren’t' : ' wasn’t'} saved: {[...sync.failing.values()][0]} Fix the red cells and they'll save.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded border border-rule p-1" role="tablist" aria-label="Entry view">
          {([['sheet', 'By judge sheet'], ['category', 'By category'], ['contestant', 'By contestant']] as const).map(([v, l]) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`rounded px-3 py-1 text-sm ${view === v ? 'bg-accent text-on-accent' : 'text-muted hover:text-fg'}`}>{l}</button>
          ))}
        </div>
        <SyncPill state={sync} />
      </div>

      {view === 'sheet' && (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Picker label="Judge" value={judgeId} onChange={setJudgeId} options={judges} />
            <Picker label="Contestant" value={contestantId} onChange={setContestantId} options={contestants} stepper />
          </div>
          <h2 className={h2}>{nameOf(judges, judgeId)}'s sheet for {nameOf(contestants, contestantId)}</h2>
          <div className={`${card} max-w-xl overflow-x-auto`}>
            <table className="w-full text-sm">
              <tbody>
                {categories.map(cat => (
                  <CategoryRows key={cat.id} cat={cat} total={sheetTotal(judgeId, contestantId, cat.components)}>
                    {cat.components.map(k => (
                      <tr key={k.id}>
                        <td className="px-3 py-1.5 pl-6">{k.name} <span className="text-xs text-muted">/ {fmt(k.max_points)}</span></td>
                        <td className="w-28 px-3 py-1"><ScoreCell {...cellProps(judgeId, contestantId, k, `${k.name}`)} /></td>
                      </tr>
                    ))}
                  </CategoryRows>
                ))}
                <tr className="border-t-2 border-fg font-semibold">
                  <td className="px-3 py-2">Sheet total</td>
                  <td className="px-3 py-2 font-mono">{fmt(sheetTotal(judgeId, contestantId, components))} / {fmt(components.reduce((s, k) => s + k.max_points, 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view === 'category' && (() => {
        const cat = categories.find(c => c.id === categoryId) ?? categories[0]!
        const multi = cat.components.length > 1
        return (
          <section className="grid gap-3">
            <Picker label="Category" value={cat.id} onChange={setCategoryId} options={categories} />
            <div className={`${card} overflow-x-auto`}>
              <table className="text-sm">
                <thead>
                  <tr className="border-b border-rule">
                    <th rowSpan={multi ? 2 : 1} className="px-3 py-2 text-left font-normal text-muted">Contestant</th>
                    {judges.map(j => <th key={j.id} colSpan={cat.components.length} className="border-l border-rule px-3 py-2">{j.name}</th>)}
                  </tr>
                  {multi && (
                    <tr className="border-b border-rule text-xs text-muted">
                      {judges.map(j => cat.components.map((k, i) => <th key={j.id + k.id} className={`px-2 py-1 font-normal ${i === 0 ? 'border-l border-rule' : ''}`}>{k.name}</th>))}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {contestants.map(c => (
                    <tr key={c.id} className="border-b border-rule last:border-0">
                      <th scope="row" className="whitespace-nowrap px-3 py-1 text-left font-normal">{c.name}</th>
                      {judges.map(j => cat.components.map((k, i) => (
                        <td key={j.id + k.id} className={`w-24 px-2 py-1 ${i === 0 ? 'border-l border-rule' : ''}`}>
                          <ScoreCell {...cellProps(j.id, c.id, k, `${j.name} ${k.name} for ${c.name}`)} />
                        </td>
                      )))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })()}

      {view === 'contestant' && (
        <section className="grid gap-3">
          <Picker label="Contestant" value={contestantId} onChange={setContestantId} options={contestants} stepper />
          <div className={`${card} overflow-x-auto`}>
            <table className="text-sm">
              <thead>
                <tr className="border-b border-rule">
                  <th className="px-3 py-2 text-left font-normal text-muted">Component</th>
                  {judges.map(j => <th key={j.id} className="px-3 py-2">{j.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {categories.map(cat => (
                  <CategoryRows key={cat.id} cat={cat} span={judges.length}>
                    {cat.components.map(k => (
                      <tr key={k.id}>
                        <td className="whitespace-nowrap px-3 py-1 pl-6">{k.name} <span className="text-xs text-muted">/ {fmt(k.max_points)}</span></td>
                        {judges.map(j => <td key={j.id} className="w-24 px-2 py-1"><ScoreCell {...cellProps(j.id, contestantId, k, `${j.name} ${k.name}`)} /></td>)}
                      </tr>
                    ))}
                  </CategoryRows>
                ))}
                <tr className="border-t-2 border-fg font-semibold">
                  <td className="px-3 py-2">Sheet total</td>
                  {judges.map(j => <td key={j.id} className="px-3 py-2 font-mono">{fmt(sheetTotal(j.id, contestantId, components))}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function CategoryRows({ cat, total, span = 1, children }: { cat: Category; total?: number; span?: number; children: React.ReactNode }) {
  return <>
    <tr className="border-t border-rule bg-bg">
      <th colSpan={span + 1} className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted">
        {cat.name}{total !== undefined && <span className="float-right font-mono normal-case">{fmt(total)}</span>}
      </th>
    </tr>
    {children}
  </>
}

function Picker({ label, value, onChange, options, stepper }: { label: string; value: string; onChange: (v: string) => void; options: Person[]; stepper?: boolean }) {
  const i = options.findIndex(o => o.id === value)
  return (
    <div className="flex items-center gap-1">
      <label className="text-sm text-muted" htmlFor={`pick-${label}`}>{label}</label>
      {stepper && <button type="button" className={iconButton} aria-label={`Previous ${label.toLowerCase()}`} disabled={i <= 0} onClick={() => onChange(options[i - 1]!.id)}>←</button>}
      <select id={`pick-${label}`} className={`${input} w-auto`} value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {stepper && <button type="button" className={iconButton} aria-label={`Next ${label.toLowerCase()}`} disabled={i >= options.length - 1} onClick={() => onChange(options[i + 1]!.id)}>→</button>}
    </div>
  )
}

type CellProps = {
  k: Component; label: string; editable: boolean; recused: boolean; value: number | null
  serverError?: string; onCommit: (v: number | null) => void
}

function ScoreCell({ k, label, editable, recused, value, serverError, onCommit }: CellProps) {
  const [local, setLocal] = useState<string | null>(null) // text being typed, or null when showing the saved value
  if (recused) return <span className="block text-center font-mono text-muted" title="Recused: filled with the other judges' average">R</span>

  const text = local ?? (value == null ? '' : fmt(value))
  const localProblem = local != null && local.trim() !== '' ? problem(Number(local), k) : null
  const message = localProblem ?? serverError

  function commit() {
    if (local == null) return
    const v = local.trim() === '' ? null : Number(local)
    if (v != null && problem(v, k)) return // keep the bad text on screen, marked red
    setLocal(null)
    if (v !== value) onCommit(v)
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    commit() // save now; on the last cell there's no next field to blur into
    const cells = [...document.querySelectorAll<HTMLInputElement>('input[data-score]')]
    cells[cells.indexOf(e.currentTarget) + (e.shiftKey ? -1 : 1)]?.focus()
  }

  return (
    <input data-score inputMode="decimal" autoComplete="off" aria-label={label} aria-invalid={!!message} title={message ?? undefined}
      disabled={!editable} value={text} onChange={e => setLocal(e.target.value)} onBlur={commit} onKeyDown={onKeyDown}
      onFocus={e => e.target.select()}
      className={`${input} px-2 py-1 text-right font-mono ${message ? 'border-danger text-danger' : ''}`} />
  )
}

function SyncPill({ state }: { state: QueueState }) {
  const [text, tone] = state.offline
    ? [`Offline · ${state.pending} waiting to save`, 'border-danger text-danger']
    : state.pending
      ? [`Saving ${state.pending}…`, 'border-rule text-muted']
      : state.failing.size
        ? [`${state.failing.size} not saved`, 'border-danger text-danger']
        : ['All saved', 'border-rule text-muted']
  return <span role="status" className={`rounded-full border px-3 py-1 font-mono text-xs ${tone}`}>{text}</span>
}
