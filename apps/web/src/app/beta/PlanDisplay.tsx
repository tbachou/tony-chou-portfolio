import type { ReactNode } from 'react';
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

const HOLD_VARS = ['--hold-1', '--hold-2', '--hold-3', '--hold-4', '--hold-5'];

export function PlanDisplay({ text, streaming }: { text: string; streaming: boolean }) {
  const plan = parsePlan(text);

  return (
    <div className="max-w-[65ch]">
      {/*
        Rendered by the page, never taken from the stream, so it is present on
        the coach path and the guard fallback path alike and cannot be
        reworded (AC-G14). It sits inside the plan card region rather than in
        page chrome, so it travels with a screenshot.
      */}
      <p className="mb-5 border-l-2 border-[color:var(--beta-border-strong)] pl-4 text-[0.9375rem] text-[color:var(--beta-muted)]">
        {PLAN_EDUCATIONAL_FRAMING}
      </p>

      {plan.intro.length > 0 && (
        <div className="text-[length:var(--beta-text-lg)] leading-relaxed text-[color:var(--beta-body)]">
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
                  <h3 className="text-[length:var(--beta-text-lg)]">
                    {stageNumber ? (
                      <>
                        <span className="sr-only">Stage {stageNumber}: </span>
                        {title}
                      </>
                    ) : (
                      title
                    )}
                  </h3>
                </div>
                <div className="mt-4">
                  <BlockList blocks={section.blocks} keyPrefix={`stage-${i}`} />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {plan.outro.length > 0 && (
        <div className="mt-6 border-l-2 border-[color:var(--beta-border)] pl-4 text-[color:var(--beta-muted)]">
          <BlockList blocks={plan.outro} keyPrefix="outro" />
        </div>
      )}

      {streaming && <span className="beta-caret" aria-hidden="true" />}
    </div>
  );
}
