import { Link, Navigate, NavLink } from 'react-router-dom'
import { useContestRole } from '../lib/useContestRole'
import { h1 } from './ui'

type Props = { contest: { id: string; name: string; status: string; event_id: string; events: { name: string } | null } }

const tabs = [
  { to: 'setup', label: 'Setup' },
  { to: 'people', label: 'People' },
  { to: 'scores', label: 'Scores' },
  { to: 'standings', label: 'Standings' },
  { to: 'comments', label: 'Comments', producersOnly: true }, // comments and history are producer-only (RLS)
  { to: 'history', label: 'History', producersOnly: true },
]

export function ContestHeader({ contest }: Props) {
  const role = useContestRole(contest.id)
  // Judges have their own sheet; the producer pages would only show them a partial picture.
  if (role === 'judge') return <Navigate to={`/judge/${contest.id}`} replace />
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Link to={`/e/${contest.event_id}`} className="text-sm text-accent print:hidden">← {contest.events?.name}</Link>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className={h1}>{contest.name}</h1>
          <span className="font-mono text-sm text-muted">{contest.status}</span>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b border-rule print:hidden" aria-label="Contest sections">
        {tabs.filter(t => !t.producersOnly || role === 'producer').map(t => (
          <NavLink key={t.to} to={`/c/${contest.id}/${t.to}`}
            className={({ isActive }) => `-mb-px border-b-2 px-3 py-2 text-sm ${isActive ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
