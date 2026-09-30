import { Link } from 'react-router-dom'
import { card } from '../components/ui'
import { PublicFooter, PublicHeader } from '../components/PublicHeader'
import { Shot } from '../components/Shot'

// Public landing page at /, for everyone. The signed-in app lives under /dashboard. Screenshots in public/landing use fictional contests only.
const cta = 'inline-block rounded bg-accent px-5 py-2.5 font-medium text-on-accent hover:opacity-90'
const ctaQuiet = 'inline-block rounded border border-rule px-5 py-2.5 font-medium hover:border-accent'

const features: { title: string; body: string }[] = [
  {
    title: 'Judges score on their phones',
    body: 'Judges sign in on their own phones, score their own sheets, add comments and submit. They only ever see their own scores. Judge without a phone? Print them paper scoresheets.',
  },
  {
    title: 'Live standings, instant results',
    body: 'Standings update as sheets come in: highs and lows dropped, deductions applied, tiebreaks run. When the last score is in, so is the winner.',
  },
  {
    title: 'No tabulation errors',
    body: 'No copying the wrong line into the wrong cell. Every score is checked against the category’s range, each judge has one score per box, and the math runs the same way every time.',
  },
  {
    title: 'Your contest, your rules',
    body: 'Straight or Olympic scoring, prelims and finals, overtime deductions with a speech timer, community votes, cross-panel interviews, a minimum to win and your own tiebreaks.',
  },
  {
    title: 'A record of every score',
    body: 'Every score entered or changed and every sheet submitted or reopened is recorded with who and when. Nobody can edit that history.',
  },
  {
    title: 'Results day, sorted',
    body: 'Reveal the placings on screen, publish the results to a public page, and give each contestant a packet with their own scores and reviewed judges’ comments.',
  },
]

const steps = [
  ['Set up', 'Start from an official template (IML, IMBB, IMsL, IMsBB, San Diego, SF Bootblack) or build your own categories, scoring and tiebreaks. Add your contestants and invite each judge by email.'],
  ['Judges score', 'Judges sign in on their own phones, score each contestant category by category, add comments and submit. A submitted sheet locks. Scores save as they’re typed and survive patchy hotel Wi-Fi, and the tally team can still enter paper sheets.'],
  ['Crown', 'Standings update live as sheets come in. When the last one lands, finalize, print the tally, publish the results page and share each contestant’s reviewed comments.'],
]

export function Landing() {
  return (
    <div className="min-h-dvh">
      <PublicHeader />

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-[5fr_6fr] md:py-20">
          <div className="grid gap-6">
            <p className="text-sm font-semibold uppercase tracking-wider text-accent">Scoring for title contests</p>
            <h1 className="font-display text-5xl leading-none font-extrabold uppercase sm:text-6xl">
              The tally is done when the last score is in.
            </h1>
            <p className="max-w-prose text-lg text-muted">
              Tallymaster.top scores leather, bear and bootblack title contests. Set it up the way your contest runs, let judges
              score on their phones, and get fast, accurate results you can trust.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/login" className={cta}>Get started</Link>
              <Link to="/features" className={ctaQuiet}>See every feature</Link>
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
                  <h3 className="text-lg font-semibold">{f.title}</h3>
                  <p className="text-muted">{f.body}</p>
                </li>
              ))}
            </ul>
            <Link to="/features" className="justify-self-start font-medium text-accent underline">See every feature →</Link>
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
          <div className="grid items-start gap-8 md:grid-cols-[1fr_3fr]">
            <figure className="mx-auto grid max-w-64 gap-2">
              <Shot name="judge-phone" alt="A judge's own scoresheet on a phone, with submitted categories locked" className="rounded-2xl" />
              <figcaption className="text-sm text-muted">Each judge scores on their own phone and sees only their own scores.</figcaption>
            </figure>
            <figure className="grid gap-2">
              <Shot name="results" alt="The public results page for a fictional contest: the winner and the full standings by category" />
              <figcaption className="text-sm text-muted">Publish the results to a public page anyone can open, no sign-in needed.</figcaption>
            </figure>
          </div>
        </section>

        <section className="border-t border-rule bg-surface">
          <div className="mx-auto grid max-w-6xl justify-items-start gap-4 px-4 py-14">
            <h2 className="font-display text-3xl font-extrabold uppercase sm:text-4xl">Run your next contest on Tallymaster.top</h2>
            <p className="max-w-prose text-muted">No more tally room spreadsheets. Sign in with your email to set up your organization and first contest.
              One flat fee per event, and what's left after running costs goes to charity.</p>
            <div className="flex flex-wrap gap-3">
              <Link to="/login" className={cta}>Get started</Link>
              <Link to="/pricing" className={ctaQuiet}>See pricing</Link>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}
