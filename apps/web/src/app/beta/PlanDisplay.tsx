import { Fragment, type ReactNode } from 'react';
import { PLAN_EDUCATIONAL_FRAMING } from '@/lib/beta-copy';

// Renders the coach's streamed markdown progressively (AC-4) with no
// markdown dependency. The coach's output contract (coach.md skill file):
// intro paragraphs, then one '## Stage N: title' section per stage
// containing '**Label:**' lines and '- ' bullet lists, then closing
// paragraphs with no heading. Cards split on '## ' headings; the trailing
// plain paragraphs of the last section are lifted out as the outro.

type Block = { kind: 'p'; text: string } | { kind: 'list'; items: string[] };

type Section = { title: string; blocks: Block[] };

type ParsedPlan = { intro: Block[]; sections: Section[]; outro: Block[] };

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'p', text: paragraph.join(' ') });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list && list.length > 0) blocks.push({ kind: 'list', items: list });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else if (line.trimStart().startsWith('- ')) {
      flushParagraph();
      list = list ?? [];
      list.push(line.trimStart().slice(2).trim());
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function parsePlan(text: string): ParsedPlan {
  const lines = text.split('\n');
  const introLines: string[] = [];
  const rawSections: { title: string; lines: string[] }[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      rawSections.push({ title: line.slice(3).trim(), lines: [] });
    } else if (rawSections.length === 0) {
      introLines.push(line);
    } else {
      rawSections[rawSections.length - 1].lines.push(line);
    }
  }

  const sections: Section[] = rawSections.map((s) => ({
    title: s.title,
    blocks: parseBlocks(s.lines),
  }));

  // The coach's closing paragraphs carry no heading, so they land inside
  // the final stage section. Inside a stage every paragraph starts with a
  // '**Label:**' line, so trailing plain paragraphs are the closing.
  const outro: Block[] = [];
  const last = sections[sections.length - 1];
  if (last) {
    while (last.blocks.length > 0) {
      const block = last.blocks[last.blocks.length - 1];
      if (block.kind === 'p' && !block.text.startsWith('**')) {
        outro.unshift(block);
        last.blocks.pop();
      } else {
        break;
      }
    }
  }

  return { intro: parseBlocks(introLines), sections, outro };
}

/** Renders '**bold**' spans inside a line of text. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold text-[color:var(--beta-ink)]">
        {part}
      </strong>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    ),
  );
}

function BlockList({ blocks, keyPrefix }: { blocks: Block[]; keyPrefix: string }) {
  return (
    <>
      {blocks.map((block, i) =>
        block.kind === 'p' ? (
          <p key={`${keyPrefix}-p${i}`} className="mt-3 first:mt-0">
            {renderInline(block.text, `${keyPrefix}-p${i}`)}
          </p>
        ) : (
          <ul key={`${keyPrefix}-l${i}`} className="mt-3 space-y-1.5 first:mt-0">
            {block.items.map((item, j) => (
              <li key={`${keyPrefix}-l${i}-${j}`} className="flex gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-[0.6em] h-1.5 w-1.5 flex-none rounded-full bg-[color:var(--beta-border-strong)]"
                />
                <span>{renderInline(item, `${keyPrefix}-l${i}-${j}`)}</span>
              </li>
            ))}
          </ul>
        ),
      )}
    </>
  );
}

/**
 * A stage's blocks regrouped as label -> content pairs.
 *
 * The coach writes each stage as a `**Label:**` line followed by its content
 * (`**Do this:**` then a bullet list, `**When:** Week 1` inline). Rendered as
 * paragraphs, finding "what am I allowed to climb" means reading the stage
 * top to bottom. A rehab plan is not read once like an essay: it is
 * re-scanned weeks later, on a phone, looking for one specific line. Pairing
 * the labels into a fixed left column turns that into a lookup.
 *
 * A `<dl>` rather than a styled grid of divs, because that is exactly what
 * this is: terms and their descriptions. Screen readers announce the pairing,
 * which the previous bold-span-inside-a-paragraph shape did not convey.
 */
type LabelRow = { label: string; lead: string; blocks: Block[] };

function toLabelRows(blocks: Block[]): { rows: LabelRow[]; leading: Block[] } {
  const leading: Block[] = [];
  const rows: LabelRow[] = [];

  for (const block of blocks) {
    const match =
      block.kind === 'p' ? block.text.match(/^\*\*(.+?):\*\*\s*(.*)$/) : null;
    if (match) {
      rows.push({ label: match[1], lead: match[2], blocks: [] });
    } else if (rows.length > 0) {
      rows[rows.length - 1].blocks.push(block);
    } else {
      // Anything before the first label keeps its ordinary rendering.
      leading.push(block);
    }
  }
  return { rows, leading };
}

function StageBody({ blocks, keyPrefix }: { blocks: Block[]; keyPrefix: string }) {
  const { rows, leading } = toLabelRows(blocks);

  // No labels at all (a coach that drifted from the format, or the
  // deterministic fallback): fall back to the plain block rendering rather
  // than dropping content.
  if (rows.length === 0) return <BlockList blocks={blocks} keyPrefix={keyPrefix} />;

  return (
    <>
      {leading.length > 0 && (
        <div className="mb-4 beta-measure">
          <BlockList blocks={leading} keyPrefix={`${keyPrefix}-lead`} />
        </div>
      )}
      {/*
        dt and dd are DIRECT grid children, with a keyed Fragment rather than a
        wrapper div. A wrapper would need `display: contents` to let the grid
        see through it, and `display: contents` is known to drop elements from
        the accessibility tree in some browsers — not a risk worth taking on
        the pairing that makes this readable.
      */}
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)]">
        {rows.map((row, i) => (
          <Fragment key={`${keyPrefix}-row${i}`}>
            <dt className="font-semibold text-[color:var(--beta-ink)] sm:text-right">
              {row.label}
            </dt>
            <dd className="beta-measure m-0">
              {row.lead && <p>{renderInline(row.lead, `${keyPrefix}-row${i}-lead`)}</p>}
              {row.blocks.length > 0 && (
                <div className={row.lead ? 'mt-2' : ''}>
                  <BlockList blocks={row.blocks} keyPrefix={`${keyPrefix}-row${i}`} />
                </div>
              )}
            </dd>
          </Fragment>
        ))}
      </dl>
    </>
  );
}

const HOLD_VARS = ['--hold-1', '--hold-2', '--hold-3', '--hold-4', '--hold-5'];

export function PlanDisplay({ text, streaming }: { text: string; streaming: boolean }) {
  const plan = parsePlan(text);

  return (
    // No blanket max-width. It used to sit here and cascade, which capped the
    // STAGE CARDS at prose width: 960px form card directly above 675px
    // bordered cards, a visible step in a strong vertical line, worst while
    // the cards stream in one at a time. Cards now span the column and each
    // TEXT role carries its own cap, in rem rather than `ch` — `ch` is the
    // width of "0" and scales with font-size, so one shared cap gave every
    // descendant a different measure (the 15px framing line ran to ~88
    // characters while the 20px intro sat at a correct ~66).
    <div>
      {/*
        Rendered by the page, never taken from the stream, so it is present on
        the coach path and the guard fallback path alike and cannot be
        reworded (AC-G14). It sits inside the plan card region rather than in
        page chrome, so it travels with a screenshot.
      */}
      <p className="mb-5 beta-measure-tight border-l-2 border-[color:var(--beta-border-strong)] pl-4 text-[0.9375rem] text-[color:var(--beta-muted)]">
        {PLAN_EDUCATIONAL_FRAMING}
      </p>

      {plan.intro.length > 0 && (
        <div className="beta-measure-wide text-[length:var(--beta-text-lg)] leading-relaxed text-[color:var(--beta-body)]">
          <BlockList blocks={plan.intro} keyPrefix="intro" />
        </div>
      )}

      {plan.sections.length > 0 && (
        <ol className="mt-6 list-none space-y-5 p-0">
          {plan.sections.map((section, i) => {
            const holdVar = HOLD_VARS[i % HOLD_VARS.length];
            const match = section.title.match(/^Stage\s+(\d+)\s*:?\s*(.*)$/i);
            const stageNumber = match ? match[1] : null;
            const title = match && match[2] ? match[2] : section.title;
            return (
              <li
                key={`stage-${i}`}
                className="beta-stage-card p-5 sm:p-6"
                style={{ ['--stage-hold' as string]: `var(${holdVar})` }}
              >
                <div className="flex items-center gap-3">
                  <span className="beta-stage-number" aria-hidden="true">
                    {stageNumber ?? i + 1}
                  </span>
                  {/* h4: these sit beneath the plan's own h3 heading. */}
                  <h4 className="text-[length:var(--beta-text-lg)]">
                    {stageNumber ? (
                      <>
                        <span className="sr-only">Stage {stageNumber}: </span>
                        {title}
                      </>
                    ) : (
                      title
                    )}
                  </h4>
                </div>
                <div className="mt-4">
                  <StageBody blocks={section.blocks} keyPrefix={`stage-${i}`} />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {plan.outro.length > 0 && (
        <div className="mt-6 beta-measure border-l-2 border-[color:var(--beta-border)] pl-4 text-[color:var(--beta-muted)]">
          <BlockList blocks={plan.outro} keyPrefix="outro" />
        </div>
      )}

      {streaming && <span className="beta-caret" aria-hidden="true" />}
    </div>
  );
}
