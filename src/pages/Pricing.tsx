import { Link } from 'react-router-dom'
import { card } from '../components/ui'
import { PublicFooter, PublicHeader } from '../components/PublicHeader'

// Public pricing page. The fee is collected by hand; a platform admin approves the event once it's paid (/admin).
const cta = 'inline-block rounded bg-accent px-5 py-2.5 font-medium text-on-accent hover:opacity-90'
const DESIRE_UNCHAINED = 'https://desireunchained.com/'
const DESIRE_UNCHAINED_LOGO = 'https://i0.wp.com/desireunchained.com/wp-content/uploads/2025/01/cropped-cropped-Desire-unchained-logo-no-zipper-2.png?w=512&ssl=1'

const included = [
  'Every contest at the event: Mr, Ms, Bootblack, Bear, and more',
  'As many contestants and judges as you need',
  'Straight or Olympic scoring, prelims and finals, deductions, community votes and cross-panel judges',
  'Official templates for IML, IMBB, IMsL, IMsBB, San Diego and SF Bootblack',
  'Instant standings, tiebreaks, an audit trail and a printable tally',
]

const steps = [
  ['Set up for free', 'Create your organization and event, then build your contests, contestants and judges. Try everything before you pay.'],
  ['Request approval', 'When you’re ready, press Request approval on the event page. We’ll email you how to pay the fee.'],
  ['Pay and score', 'Once the fee is in, we approve the event and every contest at it can start scoring.'],
]

const faq = [
  ['What counts as an event?', 'A weekend or show where titles are awarded. One fee covers every contest at it, so an event with a leather, a bootblack and a bear contest is still $100.'],
  ['Can I try it before paying?', 'Yes. Everything except scoring works before approval: set up the rubric, add contestants and judges, and start from a template or a past contest.'],
  ['Is there a subscription?', 'No. You pay once per event, and only for events you actually score.'],
  ['How long does approval last?', 'For the event itself: contests can start scoring from two weeks before the event date to two weeks after. Next year’s event is a new event.'],
]

export function Pricing() {
  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main>
        <section className="mx-auto grid max-w-6xl items-start gap-10 px-4 py-14 md:grid-cols-[1fr_1fr] md:py-20">
          <div className="grid gap-5">
            <p className="text-sm font-semibold uppercase tracking-wider text-accent">Pricing</p>
            <h1 className="font-display text-5xl leading-none font-extrabold uppercase sm:text-6xl">One flat fee per event.</h1>
            <p className="max-w-prose text-lg text-muted">
              No subscriptions and no per-contestant charges. Set everything up for free, and pay when your event is ready to score.
            </p>
          </div>
          <div className={`${card} grid gap-5 p-6`}>
            <p className="flex items-baseline gap-2">
              <span className="font-display text-6xl font-extrabold">$100</span>
              <span className="text-muted">per event</span>
            </p>
            <ul className="grid gap-2">
              {included.map(i => <li key={i} className="flex gap-2"><span aria-hidden className="text-accent">✓</span>{i}</li>)}
            </ul>
            <Link to="/login" className={`${cta} justify-self-start`}>Get started</Link>
          </div>
        </section>

        <section className="border-y border-rule bg-surface">
          <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-14 md:grid-cols-[auto_1fr]">
            <a href={DESIRE_UNCHAINED} target="_blank" rel="noreferrer" className="justify-self-center">
              <img src={DESIRE_UNCHAINED_LOGO} alt="Desire Unchained" width={176} height={176} className="rounded-lg" />
            </a>
            <div className="grid gap-3">
              <h2 className="font-display text-3xl font-extrabold uppercase sm:text-4xl">Where the money goes</h2>
              <p className="max-w-prose text-muted">
                The fee helps cover what it costs to run Tallymaster.top: hosting, the database and email. Whatever is left over is
                donated to <a href={DESIRE_UNCHAINED} target="_blank" rel="noreferrer" className="text-accent underline">Desire Unchained Events</a> as
                a fundraiser, so every contest scored here gives back to the community.
              </p>
              <p className="max-w-prose text-muted">
                Desire Unchained carries on DESIRE, the women’s leather weekend held in Palm Springs since 2004. When the original
                event held its last weekend in 2024, Sarge (IMsL 2015), one of its producers, and their girl Meg stepped up to
                continue its legacy under a new name. Desire Unchained creates safe, inclusive spaces where women and
                gender-diverse people can learn, connect and explore, with education, consent and community at its core.
              </p>
              <p className="text-sm">
                <a href="https://desireunchained.com/desire-history/" target="_blank" rel="noreferrer" className="text-accent underline">Their history</a>
                {' · '}
                <a href="https://desireunchained.com/mission-vision/" target="_blank" rel="noreferrer" className="text-accent underline">Mission &amp; vision</a>
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-8 px-4 py-14">
          <h2 className="font-display text-3xl font-extrabold uppercase sm:text-4xl">How paying works</h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {steps.map(([title, body], i) => (
              <li key={title} className="grid content-start gap-2">
                <span className="font-display text-5xl font-extrabold text-accent">{i + 1}</span>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-rule bg-surface">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14">
            <h2 className="font-display text-3xl font-extrabold uppercase sm:text-4xl">Questions</h2>
            <dl className="grid gap-4 md:grid-cols-2">
              {faq.map(([q, a]) => (
                <div key={q} className={`${card} grid content-start gap-2 bg-bg p-5`}>
                  <dt className="text-lg font-semibold">{q}</dt>
                  <dd className="text-muted">{a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
