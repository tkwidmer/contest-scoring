import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSession } from '../context/auth'
import { Brand } from '../components/Brand'

// Stage reveal: full screen, one placing at a time from the bottom up, then the winner. Reads the finalized
// result (members only). Space, Enter, → or a click moves on; ← goes back; Esc leaves.
type Standing = { contestantId: string; rank: number }
type Result = { winner: { kind: string; contestantId?: string }; standings: Standing[] }
type Card = { kicker: string; title: string; big?: boolean }

const SUFFIX = ['th', 'st', 'nd', 'rd']
const ordinal = (n: number) => `${n}${SUFFIX[(n % 100 - 20) % 10] ?? SUFFIX[n % 100] ?? 'th'}` // 1st, 2nd, 11th, 22nd

export function Announce() {
  const { contestId = '' } = useParams()
  const session = useSession()
  const [data, setData] = useState<{ name: string; result: Result | null; names: Map<string, string> } | null>(null)
  const [places, setPlaces] = useState<number | null>(null) // how many placings to reveal; null = still choosing
  const [step, setStep] = useState(0)

  const load = useCallback(async () => {
    const [c, r, cs] = await Promise.all([
      supabase.from('contests').select('name').eq('id', contestId).maybeSingle(),
      supabase.rpc('contest_final_result', { p_contest: contestId }),
      supabase.from('contestants').select('id, display_name').eq('contest_id', contestId),
    ])
    setData({ name: c.data?.name ?? '', result: (r.data as unknown as Result | null) ?? null, names: new Map((cs.data ?? []).map(x => [x.id, x.display_name])) })
  }, [contestId])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after the awaits
  useEffect(() => { if (session) load() }, [session, load])

  const cards: Card[] = (() => {
    if (!data?.result || places == null) return []
    const { result, names, name } = data
    const intro: Card = { kicker: 'And now, the results', title: name }
    if (result.winner.kind !== 'decided') return [intro, { kicker: name, title: 'No title awarded this year', big: true }]
    const others = result.standings.filter(s => s.contestantId !== result.winner.contestantId && s.rank <= places).sort((a, b) => b.rank - a.rank)
    return [intro, ...others.map(s => ({ kicker: `In ${ordinal(s.rank)} place`, title: names.get(s.contestantId) ?? '' })),
      { kicker: `Your new ${name}`, title: names.get(result.winner.contestantId!) ?? '', big: true }]
  })()

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ([' ', 'Enter', 'ArrowRight'].includes(e.key)) { e.preventDefault(); setStep(s => Math.min(s + 1, cards.length - 1)) }
      if (e.key === 'ArrowLeft') setStep(s => Math.max(s - 1, 0))
      if (e.key === 'Escape') history.back()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [cards.length])

  if (session === undefined) return null
  if (!session) return <Navigate to="/login" replace />
  if (!data) return null
  const back = <Link to={`/c/${contestId}/standings`} className="text-sm text-muted underline">Back to standings</Link>
  if (!data.result) return <main className="grid min-h-dvh place-content-center gap-3 p-6 text-center"><p>Finalize the results before announcing them.</p>{back}</main>

  if (places == null) {
    const n = data.result.standings.length
    return (
      <main className="grid min-h-dvh place-content-center gap-6 p-6 text-center">
        <Brand className="text-2xl" />
        <h1 className="font-display text-4xl font-extrabold uppercase">{data.name}</h1>
        <p className="text-muted">Which placings do you announce before the winner?</p>
        <div className="flex flex-wrap justify-center gap-2">
          {[['Winner only', 1], ['Top 3', 3], ['Top 5', 5], [`Everyone (${n})`, n]].filter(([, k], i, a) => (k as number) <= n && a.findIndex(x => x[1] === k) === i).map(([label, k]) => (
            <button key={label} className="rounded border border-rule px-4 py-2 hover:border-accent" onClick={() => { setPlaces(k as number); setStep(0) }}>{label}</button>
          ))}
        </div>
        <p className="text-sm text-muted">Then press Space, Enter or → (or click) to reveal each one. ← goes back, Esc leaves.</p>
        {back}
      </main>
    )
  }

  const card = cards[step]!
  return (
    <main className="grid min-h-dvh cursor-pointer select-none place-content-center gap-6 bg-bg p-8 text-center"
      onClick={() => setStep(s => Math.min(s + 1, cards.length - 1))}>
      <p className="text-2xl text-muted sm:text-4xl">{card.kicker}</p>
      <h1 key={step} className={`font-display font-extrabold uppercase leading-none ${card.big ? 'text-6xl text-accent sm:text-9xl' : 'text-5xl sm:text-8xl'}`}>{card.title}</h1>
      <p className="fixed bottom-4 left-0 right-0 text-xs text-muted">{step + 1} / {cards.length}</p>
    </main>
  )
}
