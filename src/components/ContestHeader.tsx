import { Link, NavLink } from 'react-router-dom'
import { h1 } from './ui'

type Props = { contest: { id: string; name: string; status: string; event_id: string; events: { name: string } | null } }

const tabs = [
  { to: 'setup', label: 'Setup' },
  { to: 'people', label: 'People' },
  { to: 'scores', label: 'Scores' },
  { to: 'standings', label: 'Standings' },
  { to: 'comments', label: 'Comments' },
]

export function ContestHeader({ contest }: Props) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Link to={`/e/${contest.event_id}`} className="text-sm text-accent print:hidden">← {contest.events?.name}</Link>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className={h1}>{contest.name}</h1>
          <span className="font-mono text-sm text-muted">{contest.status}</span>
        </div>
      </div>
      <nav className="flex gap-1 border-b border-rule print:hidden" aria-label="Contest sections">
        {tabs.map(t => (
          <NavLink key={t.to} to={`/c/${contest.id}/${t.to}`}
            className={({ isActive }) => `-mb-px border-b-2 px-3 py-2 text-sm ${isActive ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
