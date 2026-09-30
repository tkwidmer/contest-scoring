import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PublicFooter, PublicHeader } from '../components/PublicHeader'

// Privacy policy and terms. Plain language, describing what the app actually stores and does; keep them in step with
// the data model (docs/design/01-domain-model.md) when it changes, and update EFFECTIVE.
const CONTACT = 'tkwidmer@gmail.com'
const EFFECTIVE = 'September 30, 2026'

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto grid max-w-3xl gap-6 px-4 py-12 leading-relaxed [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-extrabold [&_h2]:uppercase [&_li]:ml-5 [&_li]:list-disc [&_ul]:grid [&_ul]:gap-1.5">
        <div className="grid gap-1">
          <h1 className="font-display text-4xl font-extrabold uppercase sm:text-5xl">{title}</h1>
          <p className="text-sm text-muted">Effective {EFFECTIVE}</p>
        </div>
        {children}
        <p>Questions? Email <a className="text-accent underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
      </main>
      <PublicFooter />
    </div>
  )
}

export function Privacy() {
  return (
    <Page title="Privacy policy">
      <p>
        Tallymaster.top (“we”, “us”) is a scoring service for leather, bear and bootblack title contests. This policy explains
        what information we keep, why, and who can see it. We don’t sell your information, show ads or use tracking cookies.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Your account:</strong> your email address and a display name. If you sign in with Google, Google shares your
          name, email address and profile picture with us; we use your email and name only.</li>
        <li><strong>Contest information producers enter:</strong> organization, event and contest details; contestants’ names,
          numbers, what they represent and, optionally, a contact email; judges’ names and emails; scores, deductions and
          judges’ comments.</li>
        <li><strong>Records of changes:</strong> who entered or changed each score, and who submitted or reopened each judge’s
          sheet, and when. This history keeps results trustworthy and can’t be edited.</li>
        <li><strong>Technical information:</strong> our hosting and database providers keep standard logs (such as IP address,
          browser and pages requested) to run and secure the service. Your browser stores your sign-in session and any scores
          that haven’t finished saving, so nothing is lost if the connection drops.</li>
        <li><strong>Payments:</strong> event fees are arranged with us directly. We don’t collect or store card details on the site.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To run contests: sign-in, score entry, standings, printed tallies, results and feedback.</li>
        <li>To send sign-in emails and contact producers about their events and fees.</li>
        <li>To keep the service secure and fix problems.</li>
      </ul>

      <h2>Who can see what</h2>
      <ul>
        <li><strong>Producers and tabulators</strong> of an organization see that organization’s events, contests, people and scores.
          Only producers see contestants’ contact emails and judges’ comments.</li>
        <li><strong>Judges</strong> see the contests they judge and only their own scores and comments.</li>
        <li><strong>The public</strong> sees only results a producer chooses to publish: contestant names and placings, and
          optionally totals by category. Individual judges’ scores and comments are never published.</li>
        <li><strong>Contestants</strong> receive judges’ comments only after a producer reviews and approves them, and judges’
          names only if the producer allows it.</li>
      </ul>

      <h2>Services we rely on</h2>
      <p>
        We use <strong>Supabase</strong> (database and sign-in), <strong>Vercel</strong> (hosting), <strong>Resend</strong> (sending
        email) and, if you choose it, <strong>Google</strong> (sign-in). They process information only to provide their service to us.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep contest information while the organization uses Tallymaster.top, so past results stay available. Producers can
        delete draft contests and events and unpublish results at any time. To have your account or other information deleted,
        email us; we’ll remove it unless we need to keep it to settle a dispute about a result, and we’ll tell you if so.
      </p>

      <h2>Your choices</h2>
      <p>
        You can ask us for a copy of your information, to correct it or to delete it. If you’re a contestant or judge, you can
        also ask the contest’s producer, who manages that contest’s information.
      </p>

      <h2>Age</h2>
      <p>Tallymaster.top is meant for adults. It isn’t intended for anyone under 18.</p>

      <h2>Changes</h2>
      <p>If we change this policy we’ll update it here and change the effective date. Significant changes will be announced on the site.</p>
      <p className="text-sm text-muted">See also our <Link to="/terms" className="text-accent underline">terms of service</Link>.</p>
    </Page>
  )
}

export function Terms() {
  return (
    <Page title="Terms of service">
      <p>
        These terms apply when you use Tallymaster.top. By signing in or using the site, you agree to them. If you use it on behalf
        of an organization, you agree for that organization too.
      </p>

      <h2>What Tallymaster.top does</h2>
      <p>
        Tallymaster.top is a tool for scoring title contests. It adds up the scores that are entered using the rules the producer
        sets up. We don’t run, judge or organize contests. Each contest’s producer is responsible for its rules, for the scores
        entered, for checking the result, and for what is announced.
      </p>

      <h2>Your account and your contest</h2>
      <ul>
        <li>Keep access to your email or Google account secure; anyone who can sign in as you can act as you.</li>
        <li>Producers decide who else can see and change their contests, by inviting tabulators and judges.</li>
        <li>Only enter information about people that you’re allowed to share for running the contest, and keep it accurate.</li>
      </ul>

      <h2>Fees</h2>
      <ul>
        <li>Scoring an event costs the fee shown on the <Link to="/pricing" className="text-accent underline">pricing page</Link>
          (currently $100 per event), which covers every contest at that event. Setting up is free.</li>
        <li>Contests can start scoring once the fee is paid and the event is approved, from two weeks before the event date to
          two weeks after it.</li>
        <li>What’s left after running costs goes to Desire Unchained Events as a fundraiser.</li>
        <li>For questions about refunds, email us; we’ll handle them case by case.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>Don’t use Tallymaster.top to harass anyone, post unlawful content, try to access information you haven’t been given,
        or interfere with the service or its security.</p>

      <h2>Your content</h2>
      <p>
        You keep ownership of what you enter. You allow us to store and display it as needed to run the service, including on
        public results pages once a producer publishes them.
      </p>

      <h2>No guarantees</h2>
      <p>
        We work hard to keep Tallymaster.top accurate and available, but it’s provided “as is”, without warranties. Keep your own
        record of important results, for example the printed tally. To the extent the law allows, we aren’t responsible for
        contest outcomes or decisions, or for indirect losses, and our total responsibility is limited to the fees you paid us
        in the previous 12 months.
      </p>

      <h2>Ending use</h2>
      <p>You can stop using Tallymaster.top at any time. We may suspend access for anyone who breaks these terms.</p>

      <h2>Changes</h2>
      <p>If we change these terms we’ll update them here and change the effective date. Continuing to use the site means you accept the updated terms.</p>
      <p className="text-sm text-muted">See also our <Link to="/privacy" className="text-accent underline">privacy policy</Link>.</p>
    </Page>
  )
}
