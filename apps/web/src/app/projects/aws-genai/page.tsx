import { Fragment } from 'react';
import type { Metadata } from 'next';
import { BackToProjects } from '@/components/BackToProjects';
import { SkipLink } from '@/components/SkipLink';
import { TerminalWindow } from '@/components/TerminalWindow';

const title = 'AWS GenAI Infrastructure — Project Case Study';
const description =
  'The Terraform-managed AWS footprint behind this portfolio: SNS to Lambda to Bedrock to SES feedback classification, and the interview simulator served through Bedrock behind a one-variable provider flag.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/projects/aws-genai' },
  openGraph: {
    title,
    description,
    url: '/projects/aws-genai',
    siteName: 'Tony Chou — Interactive Portfolio',
    type: 'website',
    locale: 'en_US'
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description
  }
};

// Short labels for the decorative pipeline chain. The STAGES list below is
// the accessible version of the same thing.
const PIPELINE = [
  'form',
  'api (Render)',
  'Postgres',
  'SNS',
  'Lambda',
  'Bedrock',
  'SES',
  'inbox'
];

const STAGES = [
  {
    name: 'Form → NestJS api (Render)',
    role: "The feedback form posts to a validated endpoint on the portfolio's own api. The row is written to Postgres on Render first, and that row is the durable copy — nothing downstream can lose a message."
  },
  {
    name: 'api → SNS topic (portfolio-feedback-topic)',
    role: "The publish is fire-and-forget: the visitor's response never waits on AWS and never fails because of it. With the topic ARN unset, publishing is simply off and intake still works."
  },
  {
    name: 'SNS → Lambda (portfolio-feedback-classifier)',
    role: 'Node 22, 256 MB, a 30-second timeout, reserved concurrency of 5. A second raw-email subscription stays on the same topic on purpose, so a Lambda regression still leaves an unclassified copy in the inbox.'
  },
  {
    name: 'Lambda → Bedrock (Claude Haiku 4.5)',
    role: 'One Converse call with a forced tool call returns a label and a one-line summary. It never throws: any failure — network, throttling, a schema violation — degrades to "unclassified" and the email still goes out.'
  },
  {
    name: 'Lambda → SES → inbox',
    role: 'Sends from and to a single verified identity. This call is deliberately allowed to throw, so a delivery failure fails the invocation, trips a CloudWatch alarm, and notifies through a separate ops topic — separate so a broken feedback topic cannot silence its own failure alerts.'
  }
];

const GUARDRAILS = [
  {
    name: 'IAM scoped per action, deliberately on one identity.',
    body: "The spec called for two IAM users — one for SNS publish, one for Bedrock — so either could be revoked alone. The api is one Node process and both SDK clients resolve the same ambient credential pair, so one process cannot hold two users' keys. What actually reduces blast radius here is per-action scope, and one user gets that in full: sns:Publish on exactly one topic ARN, plus bedrock:InvokeModel and InvokeModelWithResponseStream. The streaming action is a separate grant, and granting only the first fails every chat turn with AccessDenied. The divergence from the spec is written down in the api's env example as an open item rather than quietly dropped."
  },
  {
    name: "The Lambda's execution role is narrower still.",
    body: "bedrock:InvokeModel only, because it makes one non-streaming call; ses:SendEmail scoped to the single verified identity; and its own log group, declared in Terraform so retention is bounded at 30 days rather than left to the runtime's never-expire default. The Bedrock resource ARNs carry a deliberate region wildcard: a cross-region inference profile requires the permission in the source region and in every destination region."
  },
  {
    name: 'Cost control is honest about what it cannot do.',
    body: "AWS has no true hard spend cap. The monthly Bedrock budget notifies at 50% actual and 100% forecast, and that is all it does — a smoke detector, not a sprinkler. The real ceiling is the Lambda's reserved concurrency, which bounds in-flight Bedrock calls no matter the publish volume, plus the api's per-IP limits of 5 submissions an hour and 10 a day."
  },
  {
    name: 'No secret material lives in Terraform code or state, by design.',
    body: "Every principal holding a long-lived key is created by hand in the console. Terraform manages roles and policy documents, and reads the api's user through a data source rather than owning it."
  }
];

const LIMITATIONS = [
  'Delivery is at-least-once. SNS-to-Lambda retries, so a duplicate email is possible, and there is no dead-letter queue.',
  'The daily feedback cap counts rows before inserting rather than reserving atomically, so concurrent submissions from one identity can exceed the cap by a few. That race is accepted on purpose — the stakes are spam rows, not paid model calls.',
  "Terraform applies run locally from one operator's machine, not in CI. The plan is only as reviewed as the person running it.",
  "Classification quality is unreviewed model output. It sorts one person's inbox, and that is the whole of what it is trusted to do.",
  'Lambda packaging is a two-step manual workflow: bundle with esbuild, then apply. No local-exec, so applies stay reproducible — at the cost of a step you can forget.'
];

export default function AwsGenAiProjectPage() {
  return (
    <div className="min-h-dvh">
      <SkipLink label="[ skip to main content ]" />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-[46rem] px-4 py-10 focus:outline-none sm:px-0 sm:py-14"
      >
        <TerminalWindow path="tonychou@portfolio:~/projects/aws-genai$">
          <p className="text-term-sm text-term-muted">
            <span aria-hidden="true">$ </span>
            cat status.txt
          </p>
          <p className="mt-2 text-term-xs uppercase tracking-wide text-term-accent">
            [ live — production infrastructure, nothing to download ]
          </p>

          <h1 className="mt-6 text-term-2xl font-bold text-term-ink terminal-glow sm:text-term-3xl">
            AWS GenAI infrastructure
          </h1>
          <p className="mt-1 max-w-prose text-term-base text-term-body">
            The Terraform-managed AWS layer behind this site&apos;s feedback loop and interview
            simulator.
          </p>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat what-it-does.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-base leading-relaxed text-term-body">
              Unlike Beta, Panel, and Carryover, this project has no interface of its own — it is
              the infrastructure the rest of the site runs on: eighteen resources in us-east-2,
              every one of them defined in Terraform. It does two jobs. Feedback submitted anywhere
              on this site is stored in Postgres, published to an SNS topic, classified by a Claude
              model on Bedrock inside a Lambda, and emailed with a label and a one-line summary
              attached. Separately, the interview simulator on this site serves its production
              traffic through Bedrock, behind an <code>AI_PROVIDER</code> flag that reverts to the
              direct Anthropic API by changing one environment variable. Hosting stays split on
              purpose: the site is on Vercel, the api on Render, and AWS carries only the
              event-driven GenAI pieces.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat architecture.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm text-term-muted">
              One feedback submission crosses five hops. Each is listed below with the service that
              carries it and what that hop is responsible for.
            </p>

            {/*
              Decorative restatement of the same pipeline. The ordered list
              below is the real content — every hop, its service, and its job —
              so this chain is hidden from assistive tech rather than given an
              alt text that would only duplicate what follows it.
            */}
            <div
              aria-hidden="true"
              className="mt-4 flex flex-wrap items-center gap-2 text-term-xs text-term-muted"
            >
              {PIPELINE.map((node, index) => (
                <Fragment key={node}>
                  {index > 0 && <span>&rarr;</span>}
                  <span className="border border-term-border px-2 py-1 text-term-ink">{node}</span>
                </Fragment>
              ))}
            </div>

            <ol className="mt-6 space-y-4">
              {STAGES.map((stage, index) => (
                <li key={stage.name} className="flex gap-3 border-l border-term-border pl-4">
                  <span aria-hidden="true" className="text-term-muted tabular-nums">
                    {index + 1}.
                  </span>
                  <div>
                    <p className="text-term-sm font-bold text-term-ink">{stage.name}</p>
                    <p className="mt-1 text-term-sm leading-relaxed text-term-body">{stage.role}</p>
                  </div>
                </li>
              ))}
            </ol>

            <p className="mt-6 max-w-prose text-term-sm leading-relaxed text-term-body">
              The second path is much shorter. The api holds one provider seam that both the direct
              Anthropic client and the Bedrock client implement; a factory picks the implementation
              from <code>AI_PROVIDER</code> at boot, fails fast if the Bedrock credentials are
              missing, and hands the interview simulator whichever one it chose. Consumers depend on
              the seam, never on an SDK, so the swap needs no code change in either direction.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat model-choice.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm text-term-muted">
              Two workloads on Bedrock, two model classes, each with a stated reason. Not one model
              everywhere.
            </p>
            <ul className="mt-4 space-y-3">
              <li className="flex gap-2 text-term-sm leading-relaxed text-term-body">
                <span aria-hidden="true" className="text-term-muted">
                  ›
                </span>
                <span>
                  <span className="font-bold text-term-ink">Haiku 4.5 classifies feedback.</span>{' '}
                  The entire output is a four-value enum plus one line of summary, produced behind a
                  forced tool call with a JSON schema on its input. The schema does the work a
                  larger model would have been paid for, and no human reads the label as prose.
                </span>
              </li>
              <li className="flex gap-2 text-term-sm leading-relaxed text-term-body">
                <span aria-hidden="true" className="text-term-muted">
                  ›
                </span>
                <span>
                  <span className="font-bold text-term-ink">
                    Sonnet 4.6 serves the interview simulator.
                  </span>{' '}
                  A person reads every word of that output, so it gets the model whose prose is
                  worth paying for. Same seam and same code path as the direct provider — the
                  abstraction takes a per-call model override, so this is configuration, not a fork.
                </span>
              </li>
              <li className="flex gap-2 text-term-sm leading-relaxed text-term-body">
                <span aria-hidden="true" className="text-term-muted">
                  ›
                </span>
                <span>
                  <span className="font-bold text-term-ink">
                    Beta, the rehab planner, is the deliberate exception.
                  </span>{' '}
                  It stays on the direct Anthropic API on Sonnet 5 and never touches Bedrock at all.
                  Why is the next section.
                </span>
              </li>
            </ul>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat data-boundary.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
              One rule was written into the umbrella spec before a single resource existed. Beta&apos;s
              visitor content — injury details, goals, generated plans — never leaves Render and the
              direct Anthropic API. Feedback text is a separate, consented class: the form asks
              visitors not to include personal or medical details, and that text may transit AWS for
              classification and delivery, but is never stored there. No S3, no DynamoDB, and no log
              line containing it — the Lambda logs an id, a label, an outcome, and a duration, into a
              log group whose retention Terraform owns.
            </p>
            <p className="mt-4 max-w-prose text-term-sm leading-relaxed text-term-body">
              The rule was then tested by a feature that wanted to break it. Bedrock Guardrails were
              designed for Beta in depth — two shapes, both costed out. Every variant sent Beta&apos;s
              visitor content to AWS, because a guardrail has to read content in order to judge it.
              The design was reversed rather than the rule amended: Beta stayed off AWS, and the
              guardrail was built in process instead, mirroring a deterministic output guard the
              interview path already had. That in-process guard ships behind a{' '}
              <code>BETA_OUTPUT_GUARD_MODE</code> flag whose default is off — it is written and
              tested, not yet switched on for visitors.
            </p>
            <p className="mt-4 max-w-prose text-term-sm leading-relaxed text-term-body">
              Three other costs were on the same invoice, and they are why the reversal was not
              purely a matter of principle. Bedrock returns 403 for Sonnet 5 on this account, so the
              clinical reasoning core would have dropped a model class. Beta would have gained AWS as
              an availability dependency it does not have today. And per-request guardrail config is
              not expressible through the Bedrock SDK this stack uses, so the clinical half would
              have ended up application-enforced anyway.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat postmortem.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
              The classifier&apos;s first version asked the model for strict JSON in a system prompt
              and parsed the reply.
            </p>
            <p className="mt-4 max-w-prose border-l border-term-accent pl-4 text-term-base font-bold leading-relaxed text-term-ink">
              Every unit test passed. It had never once worked in production.
            </p>
            <p className="mt-4 max-w-prose text-term-sm leading-relaxed text-term-body">
              The model wrapped its JSON in a markdown fence. <code>JSON.parse</code> threw, the
              catch-all returned &quot;unclassified&quot; — and &quot;unclassified&quot; is exactly
              what a network failure or a throttle also returns. The bug was indistinguishable from
              the failure mode the fallback existed to handle, so every email arrived unclassified
              and nothing looked broken.
            </p>
            <p className="mt-4 max-w-prose text-term-sm leading-relaxed text-term-body">
              The tests are the interesting part. They mocked the Bedrock client and fed it clean
              JSON, which means the mock encoded the implementation&apos;s own assumption about what
              the model returns. A green suite at an integration boundary proves the code agrees with
              itself, and nothing more. A five-minute live smoke test found this in one invocation.
            </p>
            <p className="mt-4 max-w-prose text-term-sm leading-relaxed text-term-body">
              The fix deleted the failure category rather than handling it better. The call is now a
              Bedrock Converse request with a tool choice forcing one named tool and a JSON schema on
              its input; the SDK hands back an already-deserialized object, so no model prose is
              string-parsed anywhere. Validation stayed — a schema violation still degrades to
              &quot;unclassified&quot;, since forced tool use is far more reliable than
              prompt-and-parse but is not a guarantee — and the parse that used to fail no longer
              exists.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat guardrails.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm text-term-muted">
              A public anonymous endpoint that reaches a paid model needs limits that hold without
              supervision. Four are load-bearing:
            </p>
            <ul className="mt-4 space-y-3">
              {GUARDRAILS.map((item) => (
                <li key={item.name} className="flex gap-2 text-term-sm leading-relaxed text-term-body">
                  <span aria-hidden="true" className="text-term-muted">
                    ›
                  </span>
                  <span>
                    <span className="font-bold text-term-ink">{item.name}</span> {item.body}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat limitations.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm text-term-muted">
              Each of these is a known, accepted tradeoff rather than an oversight:
            </p>
            <ul className="mt-4 space-y-3">
              {LIMITATIONS.map((item) => (
                <li key={item} className="flex gap-2 text-term-sm leading-relaxed text-term-body">
                  <span aria-hidden="true" className="text-term-muted">
                    ›
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-10">
            <h2 className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              cat why.txt
            </h2>
            <p className="mt-2 max-w-prose text-term-sm leading-relaxed text-term-body">
              This footprint serves two goals at once. The site genuinely lacked a feedback loop, and
              the interview simulator was worth being able to move between providers without a
              rewrite. The same build is also hands-on preparation for the AWS Certified Generative
              AI Developer exam — SNS, Lambda, Bedrock, SES, IAM, and CloudWatch alarms, exercised on
              something real rather than in a sandbox that gets torn down.
            </p>
          </section>

          <div className="mt-10 border-t border-term-border pt-6">
            <BackToProjects />
          </div>
        </TerminalWindow>
      </main>
    </div>
  );
}
