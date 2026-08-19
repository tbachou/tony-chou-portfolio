import Link from 'next/link';
import { FeedbackForm } from '@/components/FeedbackForm';
import { BetaPlanner } from './BetaPlanner';
import { TopoBackground } from './TopoBackground';

// The three agents, honestly named (spec 0004 agent pipeline).
const AGENT_CARDS = [
  {
    name: 'Screen',
    model: 'Claude Haiku',
    holdVar: '--hold-1',
    body: 'A safety screener reads your answers first. If a warning sign shows up — a sudden pop with swelling, numbness, night pain — it refuses to draft anything and points you to the right professional instead. That refusal is a feature, not a failure.',
  },
  {
    name: 'Draft',
    model: 'Claude Sonnet',
    holdVar: '--hold-3',
    body: 'A stronger model writes the actual progression as structured data: four to five stages, each with a time window, exercises with sets and reps, what climbing is allowed, and the criteria for moving on.',
  },
  {
    name: 'Coach',
    model: 'Claude Haiku',
    holdVar: '--hold-5',
    body: 'A plain-language coach rewrites the draft in a warm, steady voice and streams it back to you — every number kept exactly as drafted, none of the jargon.',
  },
];

const INJURY_CHIPS = [
  { label: 'Finger pulley strain', holdVar: '--hold-1' },
  { label: 'Climber’s elbow', holdVar: '--hold-3' },
  { label: 'Shoulder impingement', holdVar: '--hold-5' },
];

const FAQ_ITEMS = [
  {
    question: 'Is this medical advice?',
    answer:
      'No. Beta is an educational demo that drafts general, conservative return-to-climbing progressions from common rehab patterns. It has not examined you, and it never overrides what a clinician tells you. If you are unsure about an injury, a physical therapist or sports-medicine doctor is the right first stop — not a website.',
  },
  {
    question: 'What are red flags, and why do you block them?',
    answer:
      'Four reported symptoms stop the tool cold: a sudden pop followed by swelling, numbness or tingling, being unable to bear weight or grip, and pain that wakes you at night. Each of those can point at something a loading plan could make worse — a rupture, a nerve problem, something structural. When one shows up, Beta drafts nothing and tells you which kind of professional to see. That hard stop is the core safety decision of the whole product.',
  },
  {
    question: 'What data do you store?',
    answer:
      'Nothing you type into the planner. Your form answers and the generated plan are never written to a database — they exist only in your browser and in the request that produces the plan. The only things the planner stores are two anonymous counters: how many plans were drafted today in total, and how many came from your (hashed) network address. Those exist purely to enforce the daily caps. The feedback form at the bottom of this page is the one exception — that message is stored and emailed to me.',
  },
  {
    question: 'Why only three injuries?',
    answer:
      'Finger pulley strains, climber’s elbow, and shoulder impingement are the most common climbing injuries and the ones with the best-established conservative rehab patterns. Staying inside that well-lit area is what keeps an educational tool honest — going wider would mean guessing, and guessing is exactly what this tool is designed not to do.',
  },
  {
    question: 'Why is there a daily cap?',
    answer:
      'Beta is a live portfolio demo with real AI costs, so it carries real cost controls: 40 plans per day globally, 6 per visitor, and 3 attempts per hour. When the daily budget is spent the form stays browsable and tells you so honestly. The caps reset at midnight UTC.',
  },
];

export default function BetaPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-[color:var(--beta-border)]">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5 sm:px-8">
          <p className="text-[length:var(--beta-text-lg)] font-bold tracking-tight text-[color:var(--beta-ink)]">
            Beta<span className="text-[color:var(--beta-accent)]">·</span>
          </p>
          <Link
            href="/"
            className="flex min-h-11 items-center gap-1 text-sm font-medium text-[color:var(--beta-muted)] transition-colors duration-[var(--beta-dur-fast)] hover:text-[color:var(--beta-accent-deep)]"
          >
            by Tony Chou <span aria-hidden="true">→</span> portfolio
          </Link>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <TopoBackground className="-right-56 -top-40 sm:-right-24" />
          <div className="relative mx-auto w-full max-w-5xl px-5 pb-16 pt-16 sm:px-8 sm:pb-24 sm:pt-24">
            <h1 className="max-w-[16ch] text-[length:var(--beta-text-3xl)] sm:text-[length:var(--beta-text-4xl)]">
              A staged path back onto the wall
            </h1>
            <p className="mt-5 max-w-[58ch] text-[length:var(--beta-text-lg)]">
              Beta is an educational AI planner for the three most common climbing injuries.
              Describe what happened, and three AI agents draft a conservative, stage-by-stage
              return to climbing — screened for warning signs first. If your injury is anything
              else, Beta is honest about that too: it only covers these three.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2.5 p-0" aria-label="Covered injuries">
              {INJURY_CHIPS.map((chip) => (
                <li key={chip.label} className="beta-chip">
                  <span
                    className="beta-hold-dot"
                    style={{ background: `var(${chip.holdVar})` }}
                    aria-hidden="true"
                  />
                  {chip.label}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <a href="#planner" className="beta-btn beta-btn-primary">
                Start your plan
              </a>
              <p className="beta-hint">Nothing you type into the planner is stored.</p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-[color:var(--beta-border)] bg-[color:var(--beta-surface-2)]">
          <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 className="text-[length:var(--beta-text-2xl)]">
              Three agents, one rope team
            </h2>
            <p className="mt-3 max-w-[58ch]">
              Every plan passes through three AI agents in sequence. Each one has a single job,
              and the first one is allowed to say no.
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {AGENT_CARDS.map((agent, i) => (
                <article key={agent.name} className="beta-card p-6">
                  <div className="flex items-center gap-3">
                    <span
                      className="beta-stage-number"
                      style={{ ['--stage-hold' as string]: `var(${agent.holdVar})` }}
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <h3 className="text-[length:var(--beta-text-lg)]">{agent.name}</h3>
                  </div>
                  <p className="beta-hint mt-3 font-medium uppercase tracking-wide">
                    {agent.model}
                  </p>
                  <p className="mt-2.5">{agent.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Planner */}
        <section id="planner" className="scroll-mt-16 border-t border-[color:var(--beta-border)]">
          <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 className="text-[length:var(--beta-text-2xl)]">Draft your plan</h2>
            <p className="mt-3 max-w-[58ch]">
              A couple of minutes of honest answers, in exchange for a staged progression you can
              take to the gym — or to your physical therapist.
            </p>
            <div className="mt-8">
              <BetaPlanner />
            </div>
          </div>
        </section>

        {/* Why I built this */}
        <section className="relative overflow-hidden border-t border-[color:var(--beta-border)] bg-[color:var(--beta-surface-2)]">
          <TopoBackground className="-bottom-64 -left-64 hidden md:block" />
          <div className="relative mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 className="text-[length:var(--beta-text-2xl)]">Why I built this</h2>
            <div className="mt-4 max-w-[65ch] space-y-4">
              <p>
                Before I wrote software, I was an occupational therapist — grading activity to
                healing tissue was my day job. I am also a climber, which means I have watched a
                lot of friends come back from tweaked pulleys too fast, or not at all. Beta ties
                the two careers together: a multi-agent AI pipeline built with the safety posture
                a clinician would insist on, starting with knowing when to refuse.
              </p>
              <p>
                The planner is deliberately stateless. Your answers and your plan are never
                stored — the only thing it writes down is a pair of anonymous daily counters that
                keep the demo’s AI bill honest. The interesting engineering is exactly there: hard safety
                rails, streaming pipelines, and real cost controls on a public AI product.
              </p>
            </div>
          </div>
        </section>

        {/* Safety FAQ */}
        <section className="border-t border-[color:var(--beta-border)]">
          <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 className="text-[length:var(--beta-text-2xl)]">Safety FAQ</h2>
            <div className="mt-8 max-w-3xl space-y-3">
              {FAQ_ITEMS.map((item) => (
                <details key={item.question} className="beta-faq">
                  <summary>{item.question}</summary>
                  <p className="max-w-[65ch] px-5 pb-5 pt-0">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Feedback */}
        <section className="border-t border-[color:var(--beta-border)] bg-[color:var(--beta-surface-2)]">
          <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 className="text-[length:var(--beta-text-2xl)]">Send feedback</h2>
            <p className="mt-3 max-w-[58ch]">
              Found a bug, or have an idea for Beta? Tell me anonymously — no account or email
              required. Unlike the planner, the message you send here is stored and emailed to
              me.
            </p>
            <p className="mt-3 max-w-[58ch]">
              This goes to a mailbox I read when I can. It is not a way to reach a clinician, and
              it is not monitored for urgent problems — if something is getting worse, contact a
              doctor or emergency services.
            </p>
            <div className="mt-8 max-w-xl">
              <FeedbackForm source="beta" variant="beta" />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[color:var(--beta-border)] bg-[color:var(--beta-surface-2)]">
        <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/"
              className="flex min-h-11 items-center gap-1 font-medium text-[color:var(--beta-ink)] transition-colors duration-[var(--beta-dur-fast)] hover:text-[color:var(--beta-accent-deep)]"
            >
              <span aria-hidden="true">←</span> Back to the portfolio
            </Link>
            <Link
              href="/projects/beta"
              className="flex min-h-11 items-center gap-1 font-medium text-[color:var(--beta-ink)] transition-colors duration-[var(--beta-dur-fast)] hover:text-[color:var(--beta-accent-deep)]"
            >
              Read the case study <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className="mt-4 text-sm text-[color:var(--beta-muted)]">
            Built by Tony Chou — occupational therapist turned software engineer.
          </p>
          <p className="mt-1.5 text-sm text-[color:var(--beta-muted)]">
            Beta is an educational demo, not medical advice, diagnosis, or physical therapy.
            Nothing you type into the planner is stored.
          </p>
        </div>
      </footer>
    </div>
  );
}
