import { Link } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { card } from '../components/ui'
import { useSession } from '../context/auth'

// Public landing page at /, for everyone. The signed-in app lives under /dashboard. Screenshots in public/landing use fictional contests only.
const cta = 'inline-block rounded bg-accent px-5 py-2.5 font-medium text-on-accent hover:opacity-90'
const ctaQuiet = 'inline-block rounded border border-rule px-5 py-2.5 font-medium hover:border-accent'

const features: { title: string; body: string; soon?: boolean }[] = [
  {
    title: 'Instant tallying',
    body: 'Standings update with every score. When the last judge’s score is in, so is the result: highs and lows dropped, deductions applied, tiebreaks run. No hour-long wait while tally checks and re-checks.',
  },
  {
    title: 'No tabulation errors',
    body: 'No copying the wrong line into the wrong cell. Every score is checked against the category’s range, each judge has exactly one score per box, and the math runs the same way every time.',
  },
  {
    title: 'Your contest, your rules',
    body: 'Straight or Olympic scoring, prelims and finals, speech overtime deductions, community votes, cross-panel interviews, a minimum score to award the title and your own tiebreak order.',
  },
  {
    title: 'An audit trail for every score',
    body: 'Every entry and every change is recorded with who made it and when. Recused judges are handled by the rules, not by hand, and a finalized result is locked.',
  },
  {
    title: 'Judges score on the website',
    body: 'Judges sign in on their phone and score from their own sheet. No paper to collect, no numbers to retype.',
    soon: true,
  },
  {
    title: 'Transparent results',
    body: 'Publish the final results to a public page for contestants and the community, with each category’s scores.',
    soon: true,
  },
]

const steps = [
  ['Set up', 'Start from an official template (IML, IMBB, IMsL, IMsBB, San Diego, SF Bootblack) or build your own categories, scoring and tiebreaks. Add contestants and judges.'],
  ['Score', 'Enter scores by judge sheet, by category or by contestant, on a laptop or phone. Every score saves as it’s typed and survives a patchy hotel Wi-Fi.'],
  ['Crown', 'Watch the standings and the projected winner build. When scoring is done, finalize, print the tally sheet and announce with confidence.'],
]

function Shot({ name, alt, className = '' }: { name: string; alt: string; className?: string }) {
  return (
    <picture>
      <source srcSet={`/landing/${name}-dark.png`} media="(prefers-color-scheme: dark)" />
      <img src={`/landing/${name}-light.png`} alt={alt} loading="lazy"
        className={`w-full rounded-lg border border-rule shadow-lg ${className}`} />
    </picture>
  )
}

export function Landing() {
  const session = useSession()
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Brand className="text-2xl" />
          <nav className="flex items-center gap-2 text-sm">
            {session
              ? <Link to="/dashboard" className="rounded bg-accent px-3 py-1 font-medium text-on-accent hover:opacity-90">Dashboard</Link>
              : <Link to="/login" className="rounded border border-rule px-3 py-1 hover:border-accent">Sign in</Link>}
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-[5fr_6fr] md:py-20">
          <div className="grid gap-6">
            <p className="text-sm font-semibold uppercase tracking-wider text-accent">Scoring for title contests</p>
            <h1 className="font-display text-5xl leading-none font-extrabold uppercase sm:text-6xl">
              The tally is done when the last score is in.
            </h1>
            <p className="max-w-prose text-lg text-muted">
              Tallymaster.top scores leather, bear and bootblack title contests. Set it up the way your contest runs, enter
              the judges’ scores, and get fast, accurate results you can trust.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/login" className={cta}>Get started</Link>
              <a href="#how" className={ctaQuiet}>How it works</a>
            </div>
          </div>
          <Shot name="standings" alt="Standings for a fictional contest: the winner, each contestant's category scores and one judge's breakdown with dropped scores struck through" />
        </section>

        <section className="border-y border-rule bg-surface">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14">
            <h2 className="font-display text-3xl font-extrabold uppercase sm:text-4xl">Trust the results of your contest</h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map(f => (
                <li key={f.title} className={`${card} grid content-start gap-2 bg-bg p-5`}>
                  {f.soon && <span className="justify-self-start rounded-full border border-accent px-2 py-0.5 text-xs font-medium text-accent">Coming soon</span>}
                  <h3 className="text-lg font-semibold">{f.title}</h3>
                  <p className="text-muted">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" className="mx-auto grid max-w-6xl gap-10 px-4 py-14">
          <h2 className="font-display text-3xl font-extrabold uppercase sm:text-4xl">How it works</h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {steps.map(([title, body], i) => (
              <li key={title} className="grid content-start gap-2">
                <span className="font-display text-5xl font-extrabold text-accent">{i + 1}</span>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="text-muted">{body}</p>
              </li>
            ))}
          </ol>
          <div className="grid items-start gap-8 md:grid-cols-[3fr_1fr]">
            <figure className="grid gap-2">
              <Shot name="score-entry" alt="Score entry grid for a fictional contest: contestants down the side, judges across the top, with every score saved" />
              <figcaption className="text-sm text-muted">Enter a whole category at once: contestants down the side, judges across the top.</figcaption>
            </figure>
            <figure className="mx-auto grid max-w-64 gap-2">
              <Shot name="phone" alt="One judge's scoresheet on a phone" className="rounded-2xl" />
              <figcaption className="text-sm text-muted">Every view works on a phone.</figcaption>
            </figure>
          </div>
        </section>

        <section className="border-t border-rule bg-surface">
          <div className="mx-auto grid max-w-6xl justify-items-start gap-4 px-4 py-14">
            <h2 className="font-display text-3xl font-extrabold uppercase sm:text-4xl">Run your next contest on Tallymaster.top</h2>
            <p className="max-w-prose text-muted">No more tally room spreadsheets. Sign in with your email to set up your organization and first contest.</p>
            <Link to="/login" className={cta}>Get started</Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-6 text-sm text-muted">
        <Brand className="text-base" />
        <span>Made for the leather community.</span>
      </footer>
    </div>
  )
}
