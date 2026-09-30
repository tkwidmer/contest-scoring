import { Link } from 'react-router-dom'
import { card } from '../components/ui'
import { Shot } from '../components/Shot'
import { PublicFooter, PublicHeader } from '../components/PublicHeader'

// Public page listing everything the app does, grouped the way a contest weekend runs.
const cta = 'inline-block rounded bg-accent px-5 py-2.5 font-medium text-on-accent hover:opacity-90'
const ctaQuiet = 'inline-block rounded border border-rule px-5 py-2.5 font-medium hover:border-accent'

type Group = { id: string; title: string; intro: string; shot?: { name: string; alt: string; phone?: boolean }; items: [string, string][] }

const groups: Group[] = [
  {
    id: 'setup', title: 'Set up your contest', intro: 'Build the scoresheet the way your contest actually runs, or start from one that already does.',
    items: [
      ['Official templates', 'Start from IML, IMBB, IMsL, IMsBB, San Diego Leather & Leatherbear, San Diego Bootblack or SF Bootblack, then adjust.'],
      ['Your own scoresheet', 'Categories made of scored parts, each with its own range and step (0–10 in halves, 0–60, anything), and notes that tell judges what a top score looks like.'],
      ['Straight or Olympic scoring', 'Count every judge, drop each category’s highest and lowest judge, or drop the judges with the highest and lowest totals.'],
      ['Prelims and finals', 'Cut to the top contestants after preliminaries, with prelim scores carried into the finals or a fresh start. Ties at the cut line are settled by your tiebreaks or your pick.'],
      ['A minimum to win', 'Set the percentage a contestant needs to take the title (or only when there’s a single contestant). Below it, no title is awarded.'],
      ['Your tiebreak order', 'Drop categories in the order your rules say, count every judge in a step if you want, and record a judges’ vote if it’s still tied.'],
      ['Deductions', 'Speech overtime and other penalties, as points or a percentage, applied by the tally master.'],
      ['Community votes and cross-panel judges', 'Enter a community vote once per contestant. Let another contest’s judges score an interview, either as one averaged extra judge or as a panel of their own.'],
      ['Reuse what works', 'Copy a past contest or save your own templates, then paste in your contestant and judge lists straight from a spreadsheet.'],
    ],
  },
  {
    id: 'judges', title: 'Judges', intro: 'Judges score on their own phones. The ones who’d rather not can still use paper.', shot: { name: 'judge-phone', alt: 'A judge’s own scoresheet on a phone', phone: true },
    items: [
      ['Invite by email or text', 'Send a sign-in link or copy an invite to text. Judges sign in with a code; no passwords, nothing to install.'],
      ['Their own sheets only', 'Each judge sees only their own scores, never anyone else’s or the standings.'],
      ['Built for phones', 'Big score boxes, the rubric notes right under each one, and a total for each contestant.'],
      ['Survives bad Wi-Fi', 'Scores save as they’re typed, wait on the phone if the connection drops, and send themselves when it’s back.'],
      ['Submit and lock', 'A judge submits each category (or all of a contestant’s finished sheets at once) and the sheet locks. Only a producer can reopen it, with a reason.'],
      ['Comments for contestants', 'Judges leave a comment on each category and an overall note for each contestant.'],
      ['Paper scoresheets', 'For a judge without a phone: print a page per contestant per category, with their name or blank, then type the scores in afterwards.'],
      ['Recusals', 'Mark a judge recused from a contestant; their slot is filled with the other judges’ average, automatically.'],
    ],
  },
  {
    id: 'tally', title: 'At the tally table', intro: 'Everything the tally team needs on one screen, and nothing to add up by hand.', shot: { name: 'standings', alt: 'Live standings with each judge’s scores and the dropped high and low struck through' },
    items: [
      ['Live standings', 'Standings, the projected winner and each judge’s scores update as sheets come in, with dropped highs and lows struck through.'],
      ['Judge progress', 'See what each judge has entered and submitted, and copy a friendly reminder to text anyone still behind.'],
      ['Three ways to enter paper scores', 'By judge sheet, a whole category at once, or one contestant at a time, on a laptop or a phone.'],
      ['Every score checked', 'Each score must be in range and on a step, and each judge has exactly one score per box. No wrong line in the wrong cell.'],
      ['Speech timer', 'Time a speech; when it runs over, one tap applies the right deduction.'],
      ['Tabulators', 'Give the tally team their own role: they enter scores and submit paper sheets, but can’t change the setup, unlock a judge’s sheet or finalize.'],
    ],
  },
  {
    id: 'results', title: 'Results day', intro: 'From the last score to the sash, and everything the contestants get afterwards.', shot: { name: 'results', alt: 'A published results page with the winner and the full standings' },
    items: [
      ['Finalize and lock', 'Freeze the result once it’s decided, so scores can’t change. A producer can reopen scoring if something needs fixing.'],
      ['Printed tally', 'A clean printout: a summary with signature lines, then a page per contestant with every judge’s scores.'],
      ['Announce on screen', 'A full-screen reveal for the stage, from the placings you choose up to the new titleholder.'],
      ['Public results page', 'Publish the winner and placings, or the full standings by category, to a page anyone can open. Individual judges’ scores and comments are never shown.'],
      ['Your organization’s results', 'Every result you publish is listed on your organization’s own public page, year after year.'],
      ['Reviewed comments and packets', 'Approve (and gently edit) judges’ comments, choose whether judge names are shown, and print each contestant a packet with their own scores and comments.'],
    ],
  },
  {
    id: 'trust', title: 'Trust and records', intro: 'Results people can check, and a record of how they were reached.',
    items: [
      ['A history of every score', 'Every score entered, changed or cleared, and every sheet submitted or unlocked, with who and when. Nobody can edit it.'],
      ['Download everything', 'Export every judge’s score as a spreadsheet for your organization’s records.'],
      ['Permissions built in', 'Producers, tabulators and judges each see and do only what their role allows, enforced by the database itself.'],
    ],
  },
]

export function Features() {
  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main>
        <section className="mx-auto grid max-w-6xl gap-5 px-4 py-14 md:py-20">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent">Features</p>
          <h1 className="max-w-3xl font-display text-5xl leading-none font-extrabold uppercase sm:text-6xl">Everything your title contest needs</h1>
          <p className="max-w-prose text-lg text-muted">
            Tallymaster.top covers the whole weekend: setting up the scoresheet, judges scoring on their phones (or paper), the tally
            table, and results day.
          </p>
          <nav aria-label="Feature sections" className="flex flex-wrap gap-2">
            {groups.map(g => <a key={g.id} href={`#${g.id}`} className="rounded-full border border-rule px-3 py-1 text-sm hover:border-accent">{g.title}</a>)}
          </nav>
        </section>

        {groups.map((g, i) => (
          <section key={g.id} id={g.id} className={`scroll-mt-4 border-t border-rule ${i % 2 === 0 ? 'bg-surface' : ''}`}>
            <div className={`mx-auto grid max-w-6xl items-start gap-10 px-4 py-14 ${g.shot ? (g.shot.phone ? 'md:grid-cols-[2fr_1fr]' : 'lg:grid-cols-[3fr_2fr]') : ''}`}>
              <div className="grid gap-6">
                <div className="grid gap-2">
                  <h2 className="font-display text-3xl font-extrabold uppercase sm:text-4xl">{g.title}</h2>
                  <p className="max-w-prose text-muted">{g.intro}</p>
                </div>
                <ul className={`grid gap-4 sm:grid-cols-2 ${g.shot ? '' : 'lg:grid-cols-3'}`}>
                  {g.items.map(([title, body]) => (
                    <li key={title} className={`${card} grid content-start gap-1.5 p-4 ${i % 2 === 0 ? 'bg-bg' : ''}`}>
                      <h3 className="font-semibold">{title}</h3>
                      <p className="text-sm text-muted">{body}</p>
                    </li>
                  ))}
                </ul>
              </div>
              {g.shot && <div className={g.shot.phone ? 'mx-auto w-full max-w-64 md:sticky md:top-6' : 'lg:sticky lg:top-6'}>
                <Shot name={g.shot.name} alt={g.shot.alt} className={g.shot.phone ? 'rounded-2xl' : ''} />
              </div>}
            </div>
          </section>
        ))}

        <section className="border-t border-rule">
          <div className="mx-auto grid max-w-6xl justify-items-start gap-4 px-4 py-14">
            <h2 className="font-display text-3xl font-extrabold uppercase sm:text-4xl">One flat fee per event</h2>
            <p className="max-w-prose text-muted">$100 covers every contest at your event. Set everything up for free and pay when you’re ready to score; what’s left after running costs goes to Desire Unchained Events.</p>
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
