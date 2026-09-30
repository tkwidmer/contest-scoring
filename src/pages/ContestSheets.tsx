import { Fragment, useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { friendly } from '../lib/errors'
import { fmt } from '../lib/scoreCells'
import { ContestHeader } from '../components/ContestHeader'
import { button, card, input, label } from '../components/ui'

// Paper scoresheets for judges who score on paper: one portrait page per contestant with the categories this judge
// scores, each component's range and notes, boxes to write in and a comment area. The tally team types them in
// afterwards (Scores > By judge sheet), the same page order. Print, or "Save as PDF" in the print dialog.
type Component = { id: string; name: string; description: string | null; min_points: number; max_points: number; step: number }
type Category = { id: string; name: string; round: string; scored_by: string; guest_average: boolean; components: Component[] }
type Judge = { id: string; name: string; guest: boolean }
type Contestant = { id: string; display_name: string; number: number | null; finalist: boolean }
type Contest = { id: string; name: string; status: string; event_id: string; finalist_count: number | null; events: { name: string } | null }

const BLANK = 'blank'

export function ContestSheets() {
  const { contestId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const [contest, setContest] = useState<Contest | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [judges, setJudges] = useState<Judge[]>([])
  const [contestants, setContestants] = useState<Contestant[]>([])
  const [recused, setRecused] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [c, cats, js, cs, rs] = await Promise.all([
      supabase.from('contests').select('id, name, status, event_id, finalist_count, events(name)').eq('id', contestId).maybeSingle(),
      supabase.from('categories').select('id, name, round, scored_by, guest_average, components(id, name, description, min_points, max_points, step)')
        .eq('contest_id', contestId).order('sort').order('sort', { referencedTable: 'components' }),
      supabase.from('judges').select('id, name, guest').eq('contest_id', contestId).order('sort'),
      supabase.from('contestants').select('id, display_name, number, finalist').eq('contest_id', contestId).eq('withdrawn', false).order('sort'),
      supabase.from('recusals').select('judge_id, contestant_id, judges!inner(contest_id)').eq('judges.contest_id', contestId),
    ])
    const failed = c.error ?? cats.error ?? js.error ?? cs.error ?? rs.error
    if (failed) return setError(friendly(failed))
    if (!c.data) return setError("This contest doesn't exist, or you're not a member of its organization.")
    setContest(c.data)
    setCategories(cats.data ?? [])
    setJudges(js.data ?? [])
    setContestants(cs.data ?? [])
    setRecused(new Set((rs.data ?? []).map(r => `${r.judge_id}|${r.contestant_id}`)))
  }, [contestId])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the awaits
  useEffect(() => { load() }, [load])

  if (!contest) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-muted">Loading…</p>

  const rounds = contest.finalist_count != null
  const judgeId = params.get('judge') ?? BLANK
  const round = rounds ? (params.get('round') ?? 'prelim') : null
  const set = (k: string, v: string) => setParams(p => { const n = new URLSearchParams(p); n.set(k, v); return n }, { replace: true })
  const judge = judges.find(j => j.id === judgeId)
  // The categories this judge fills in (a blank sheet has the panel's); in two-round contests, one round at a time.
  const cats = categories.filter(c => c.scored_by !== 'producer'
    && (judge?.guest ? c.scored_by === 'cross_panel' || c.guest_average : c.scored_by === 'judges')
    && (!round || c.round === round))
  const people = contestants.filter(p => !(judge && recused.has(`${judge.id}|${p.id}`))
    && !(round === 'final' && contestants.some(x => x.finalist) && !p.finalist))
  const who = (p: Contestant) => `${p.number != null ? `#${p.number} · ` : ''}${p.display_name}`
  const range = (k: Component) => `${fmt(k.min_points)}–${fmt(k.max_points)}${k.step !== 1 ? ` in steps of ${fmt(k.step)}` : ''}`
  const box = 'border border-fg'

  return (<>
    <div className="grid gap-6 print:hidden">
      <ContestHeader contest={contest} />
      <p className="max-w-prose text-muted">
        Paper scoresheets for a judge who can't score on a phone or computer: one page per contestant, with the categories they
        score and room for comments. Print them, or choose <strong>Save as PDF</strong> in the print dialog. Afterwards, type the
        scores in on <strong>Scores → By judge sheet</strong>.
      </p>
      <div className={`${card} flex flex-wrap items-end gap-4 p-4`}>
        <label className="grid gap-1"><span className={label}>Judge</span>
          <select className={`${input} w-auto`} value={judge ? judge.id : BLANK} onChange={e => set('judge', e.target.value)}>
            <option value={BLANK}>Blank (write the judge's name in)</option>
            {judges.map(j => <option key={j.id} value={j.id}>{j.name}{j.guest ? ' (cross-panel)' : ''}</option>)}
          </select></label>
        {rounds && (
          <label className="grid gap-1"><span className={label}>Round</span>
            <select className={`${input} w-auto`} value={round!} onChange={e => set('round', e.target.value)}>
              <option value="prelim">Preliminaries</option>
              <option value="final">Finals{contestants.some(x => x.finalist) ? ' (finalists only)' : ''}</option>
            </select></label>
        )}
        <button className={button} disabled={!cats.length || !people.length} onClick={() => window.print()}>Print {people.length} sheet{people.length === 1 ? '' : 's'}</button>
      </div>
      {!cats.length && <p className="text-muted">This judge has no categories to score{round ? ' in this round' : ''}.</p>}
      {judge && recused.size > 0 && contestants.length > people.length && <p className="text-sm text-muted">Contestants this judge is recused from are left out.</p>}
      <p className="text-sm text-muted">Preview of the first sheet:</p>
    </div>

    {people.map((p, i) => (
      <section key={p.id} className={`break-after-page text-[10.5pt] leading-snug text-fg [page:feedback] ${i > 0 ? 'hidden print:block' : `${card} mt-4 p-6 print:border-0 print:p-0`}`}>
        <header className="flex items-end justify-between gap-4 border-b-2 border-fg pb-2">
          <div>
            <p className="text-muted">{contest.events?.name}</p>
            <h1 className="font-display text-2xl font-extrabold uppercase">{contest.name}{round && ` · ${round === 'prelim' ? 'Preliminaries' : 'Finals'}`}</h1>
          </div>
          <p className="text-right text-muted">Sheet {i + 1} of {people.length}</p>
        </header>
        <div className="mt-3 grid grid-cols-2 gap-6">
          <p>Contestant: <strong className="text-[13pt]">{who(p)}</strong></p>
          <p>Judge: {judge ? <strong className="text-[13pt]">{judge.name}</strong> : <span className="inline-block w-48 border-b border-fg" />}</p>
        </div>
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="text-left text-[9pt] text-muted">
              <th className="py-1 font-normal">Category / component</th>
              <th className="w-40 py-1 text-right font-normal">Range</th>
              <th className="w-24 py-1 text-center font-normal">Score</th>
            </tr>
          </thead>
          <tbody>
            {cats.map(c => (<Fragment key={c.id}>
              <tr><td colSpan={3} className="border-t border-fg pt-3 pb-1 font-semibold uppercase tracking-wider">{c.name}</td></tr>
              {c.components.map(k => (
                <tr key={k.id} className="break-inside-avoid">
                  <td className="py-1.5 pr-2">{k.name}{k.description && <span className="block text-[9pt] text-muted">{k.description}</span>}</td>
                  <td className="whitespace-nowrap py-1.5 text-right font-mono text-[9pt] text-muted">{range(k)}</td>
                  <td className="py-1.5 pl-3"><div className={`${box} h-9 w-full`} /></td>
                </tr>
              ))}
              <tr className="break-inside-avoid">
                <td colSpan={3} className="pb-2">
                  <span className="text-[9pt] text-muted">Comments for the contestant on {c.name} (optional)</span>
                  <div className="mt-1 h-14 border-b border-dashed border-muted" />
                </td>
              </tr>
            </Fragment>))}
          </tbody>
        </table>
        <div className="mt-4 grid grid-cols-2 gap-6 break-inside-avoid">
          <div>
            <span className="text-[9pt] text-muted">Overall comments (optional)</span>
            <div className="mt-1 h-16 border-b border-dashed border-muted" />
          </div>
          <div className="grid content-end gap-4">
            <p className="flex items-end gap-2">Judge's signature <span className="flex-1 border-b border-fg" /></p>
            <p className="text-[9pt] text-muted">Tally use: entered by ______ checked by ______</p>
          </div>
        </div>
      </section>
    ))}
  </>)
}
