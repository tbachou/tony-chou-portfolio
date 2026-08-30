/**
 * The seed data for topics and stories, extracted from seed.ts (spec 0011,
 * build plan task 1) so the interview eval harness can import it without the
 * side effects seed.ts carries (the Prisma client and better-auth both connect
 * at module load). This file must stay side effect free: types, enums, and
 * plain arrays only.
 */
import { StoryOwnership } from '../src/generated/prisma/enums';

export type TopicSeed = {
  slug: string;
  label: string;
  description: string;
  sortOrder: number;
};

export type StorySeed = {
  title: string;
  ownership: StoryOwnership;
  engagement: string;
  summary: string;
  requiredFraming?: string;
  topics: string[];
};

// Topic slugs group the 21 verified stories from KNOWLEDGE_BASE.md into curated
// conversation topics. Every topic below maps to 3+ stories; the seed fails
// loudly if that ever drops under 2 (the round-robin story selection in
// spec 0002 needs at least 2 to rotate).
export const topics: TopicSeed[] = [
  {
    slug: 'real-time-collaboration',
    label: 'Real-time collaborative products',
    description: 'Building products where multiple people edit and see the same state live.',
    sortOrder: 0,
  },
  {
    slug: 'ai-agents-integration',
    label: 'AI agents and orchestration',
    description:
      'Making AI agents reliable in production: coordination, chunking, and tool selection under real constraints.',
    sortOrder: 1,
  },
  {
    slug: 'ai-content-generation',
    label: 'AI content generation at scale',
    description: 'Shipping AI-generated content features to a large, existing user base.',
    sortOrder: 2,
  },
  {
    slug: 'platform-integrations',
    label: 'Third-party platform integrations',
    description: 'Bridging a product to Chrome extensions, Jira, Google Sheets, and meeting-bot platforms.',
    sortOrder: 3,
  },
  {
    slug: 'data-infrastructure',
    label: 'Data platforms and infrastructure',
    description: 'Migrating and scaling the data layer underneath a product.',
    sortOrder: 4,
  },
  {
    slug: 'product-ownership',
    label: 'Full-cycle product ownership',
    description: 'Owning a feature, or a company, end to end: onboarding, entrepreneurship, and mentorship.',
    sortOrder: 5,
  },
];

export const stories: StorySeed[] = [
  {
    title: 'Three-layer state management architecture',
    ownership: StoryOwnership.SOLO,
    engagement: 'Product Forge',
    summary:
      'Split real-time collaborative document state (Liveblocks, typed LiveObject/LiveList, live cursors and presence), server-persisted state (TanStack Query, cache invalidation), and local UI state (Context/reducer) into three distinct layers instead of one undifferentiated store, fixing a real class of stale-state and re-render bugs. liveblocks.config.ts: 10/10 commits Tony; TanStack Query layer: 8/9 commits Tony; reducer pattern: 13/15 commits Tony.',
    topics: ['real-time-collaboration'],
  },
  {
    title: 'Chrome extension backend integration',
    ownership: StoryOwnership.SOLO,
    engagement: 'Product Forge (Aug 2024 - Aug 2025)',
    summary:
      "Built and maintained the API layer bridging a companion Chrome extension to the core backend: bearer-token auth (extensions can't share cookies with the main app's domain), Liveblocks real-time sync passthrough, and full artifact/meeting CRUD proxying across 30+ route handlers, plus a first-time-user onboarding flow and a major version upgrade. 85 of roughly 96 commits on this surface are Tony's.",
    topics: ['platform-integrations'],
  },
  {
    title: 'Autosave system origination',
    ownership: StoryOwnership.SOLO,
    engagement: 'Product Forge (Mar-Dec 2024)',
    summary:
      'Built the original debounced autosave (useDebouncedEffect) and wired it into the artifact editor using dirty-state tracking, iterating on delay and timing repeatedly over about 9 months. A teammate reworked the editor-specific hook further after Tony had rotated to the next engagement; that later stale-closure and grace-period refinement is not part of this story.',
    topics: ['real-time-collaboration'],
  },
  {
    title: 'Tool-coordination gate',
    ownership: StoryOwnership.SOLO,
    engagement: 'Product Forge (Jun 2025)',
    summary:
      "Built tool-coordination.ts, a boolean-lock coordinator with a 30 second timeout preventing the AI assistant's web_search and deep_research tools from executing simultaneously in one response. This is a scoped concurrency gate for two specific tools, not a general write-conflict or entity-locking mechanism.",
    topics: ['ai-agents-integration'],
  },
  {
    title: 'Transcript-chunking logic',
    ownership: StoryOwnership.SOLO,
    engagement: 'Product Forge (Sep 2025)',
    summary:
      'Within the larger agentic assistant, personally designed and built the chunking strategy: try the full transcript first, only chunk on context-window overflow, and break at sentence or speaker boundaries rather than a fixed character cutoff.',
    topics: ['ai-agents-integration'],
  },
  {
    title: 'Original Jira integration',
    ownership: StoryOwnership.SOLO,
    engagement: 'Product Forge (Jul-Sep 2024)',
    summary:
      "Built the first iteration of in-app Jira board and project access inside the Context Center panel. This predates and is separate from the later OAuth-based multi-platform sync hub a teammate built in 2025, and separate from the Chrome extension work.",
    topics: ['platform-integrations'],
  },
  {
    title: 'Google Sheets integration',
    ownership: StoryOwnership.SOLO,
    engagement: 'Product Forge (Aug 2024 POC onward)',
    summary:
      "Built read and write access to Google Sheets within the Chrome extension. 4 of 5 commits on this surface are Tony's.",
    topics: ['platform-integrations'],
  },
  {
    title: 'react-quill to raw Quill.js migration',
    ownership: StoryOwnership.SOLO,
    engagement: 'Product Forge (Mar-Apr 2024)',
    summary:
      'Dropped the React wrapper library in favor of raw Quill.js to get direct control over toolbar customization and collaborative-editing integration.',
    topics: ['real-time-collaboration'],
  },
  {
    title: 'Topstep onboarding rebuild',
    ownership: StoryOwnership.SOLO,
    engagement: 'Topstep (Sep 2025 - Jul 2026)',
    summary:
      'Independently rebuilt user onboarding with route-based workflows, LaunchDarkly A/B testing, and Datadog instrumentation, uncovering an unexpected drop-off step in the process.',
    topics: ['product-ownership'],
  },
  {
    title: 'Fugue AI co-founding',
    ownership: StoryOwnership.SOLO,
    engagement: 'Fugue AI (2022-2024, part-time)',
    summary:
      'Co-founded an AI creative platform combining DALL-E and Stable Diffusion image generation, built full-stack on AWS, and owned all engineering decisions end to end. The venture saw no significant commercial traction, which is fine to say plainly if asked; the value of this story is full-cycle ownership, not business outcome.',
    topics: ['product-ownership'],
  },
  {
    title: 'Agentic AI assistant "Smith"',
    ownership: StoryOwnership.CONTRIBUTED,
    engagement: 'Product Forge',
    summary:
      "Core orchestration was originated by a teammate in May 2025, with a formal multi-step agent wrapper built by another teammate in October 2025 after Tony's active period on this surface. Tony's specific contributions were the transcript-chunking and context-window handling that let it work reliably on long meetings (see the transcript-chunking story), plus tool-selection prompting improvements and artifact-type-picker logic.",
    requiredFraming:
      'I contributed to an existing agentic assistant rather than architecting it from scratch — my specific ownership was the transcript-chunking and context-window handling that let it work reliably on long meetings, plus tool-selection prompting improvements.',
    topics: ['ai-agents-integration'],
  },
  {
    title: 'Recall.ai meeting bot integration',
    ownership: StoryOwnership.CONTRIBUTED,
    engagement: 'Product Forge',
    summary:
      'The core backend API client is 18 of 26 commits from a teammate who started this work in August 2024. Tony contributed the client-side bot-connect UI, status-polling, consolidating duplicated status-check logic, and piping transcripts into the artifact pipeline.',
    requiredFraming:
      'I contributed to the client-side bot-connect UI and status-polling for our Recall.ai integration; the core backend API client was built by a teammate.',
    topics: ['platform-integrations'],
  },
  {
    title: 'Topstep Trader Public Profile platform',
    ownership: StoryOwnership.CONTRIBUTED,
    engagement: 'Topstep',
    summary:
      'Contributed to data model design and helped build the GraphQL API layer and React UI for the Trader Public Profile platform, as part of a team effort. Did not own this feature end to end.',
    requiredFraming:
      "I was part of a team that built the Trader Public Profile platform — I contributed to the data model design and helped build the GraphQL API layer and React UI, but this wasn't a feature I owned end to end.",
    topics: ['data-infrastructure'],
  },
  {
    title: 'Trade metric computation migration',
    ownership: StoryOwnership.CONTRIBUTED,
    engagement: 'Topstep',
    summary:
      "Ported trade metric computation from an existing TypeORM-based Node.js implementation into Topstep's new GraphQL API architecture, working with stakeholders to validate calculation accuracy for high-volume trader accounts. The computation was always server-side; the actual work was the TypeORM-to-GraphQL architectural port, not a move to server-side.",
    requiredFraming:
      'I worked on porting our trade metric computation from a TypeORM-based implementation into our new GraphQL API architecture, validating calculation accuracy with stakeholders along the way.',
    topics: ['data-infrastructure'],
  },
  {
    title: 'Mailchimp AI content generation',
    ownership: StoryOwnership.CO_LED,
    engagement: 'Mailchimp',
    summary:
      "Co-led a team of 3 to 4 engineers building Mailchimp's first-generation AI content generation feature on top of the existing ProseMirror-based email editor, shipped to millions of users while supporting two concurrent editor versions. Designed the state-management layer integrating AI output into ProseMirror's typed node document model.",
    requiredFraming:
      "I co-led a team of 3 to 4 engineers building Mailchimp's first-generation AI content generation feature, and personally designed the state-management layer that integrated AI output into our editor's document model.",
    topics: ['ai-content-generation'],
  },
  {
    title: 'ProseMirror document visualizer',
    ownership: StoryOwnership.SOLO,
    engagement: 'Mailchimp',
    summary:
      'Built a JSON document visualizer tool for inspecting ProseMirror document state during the AI content generation feature build. Solo-owned within the broader Mailchimp AI effort.',
    topics: ['ai-content-generation'],
  },
  {
    title: "Mailchimp's first content-generation tool",
    ownership: StoryOwnership.CONTRIBUTED,
    engagement: 'Mailchimp',
    summary:
      'Integrated a content-generation engine Mailchimp had acquired, rather than built in-house, into the ProseMirror editor. This predates and established the integration pattern for the later LLM-based AI content generation feature.',
    requiredFraming:
      'I worked on integrating an acquired content-generation engine into our ProseMirror editor, which established the integration pattern our later AI feature built on.',
    topics: ['ai-content-generation'],
  },
  {
    title: 'AI content in Automation Flows',
    ownership: StoryOwnership.CONTRIBUTED,
    engagement: 'Mailchimp',
    summary:
      "Extended AI-generated content into Mailchimp's Automation Flows, the trigger-based automated email sequences, beyond the single-email editor.",
    requiredFraming:
      'I contributed to extending AI-generated content into Automation Flows, beyond the single-email editor experience.',
    topics: ['ai-content-generation'],
  },
  {
    title: 'AI content analytics instrumentation',
    ownership: StoryOwnership.CONTRIBUTED,
    engagement: 'Mailchimp',
    summary:
      "Partnered with Mailchimp's data analytics team to instrument tracking for the new AI-generated content features, establishing feedback loops for adoption measurement.",
    requiredFraming:
      'I helped instrument tracking for the new AI content features by partnering with our data analytics team.',
    topics: ['ai-content-generation'],
  },
  {
    title: 'SQL to Google Cloud Spanner migration',
    ownership: StoryOwnership.CO_LED,
    engagement: 'Mailchimp',
    summary:
      'Co-led a migration from SQL to Google Cloud Spanner, learning Spanner and Cloud Dataflow (used for the migration pipeline) while both were new to the team, driving a $500K per year infrastructure cost reduction through staged migrations and regression testing.',
    requiredFraming:
      'I co-led our SQL to Google Cloud Spanner migration, learning Spanner and Cloud Dataflow alongside the rest of the team as we drove a $500K per year infrastructure cost reduction.',
    topics: ['data-infrastructure'],
  },
  {
    title: 'Ongoing engineering mentorship',
    ownership: StoryOwnership.SOLO,
    engagement: 'Tensure Consulting (ongoing)',
    summary:
      'Mentors a software engineer on the Product Forge team through structured 1:1s, providing career guidance and technical development support. This is a Tensure-wide activity, independent of any single client engagement, and continues even though Tony has rotated off Product Forge itself.',
    topics: ['product-ownership'],
  },
];
