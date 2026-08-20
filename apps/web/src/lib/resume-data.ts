export const RESUME_PDF_PATH = '/resume.pdf';

export const contactInfo = {
  email: 'chou.0626@gmail.com',
  linkedin: 'https://www.linkedin.com/in/tony-chou-22598085',
  location: 'Westerville, OH'
};

export const skillGroups = [
  {
    label: 'Languages & frameworks',
    items: ['TypeScript', 'JavaScript', 'React', 'Next.js', 'Node.js', 'Python', 'React Native']
  },
  {
    label: 'State management & real-time',
    items: ['Redux', 'Redux Toolkit', 'TanStack Query', 'Zustand', 'Liveblocks', 'WebSockets', 'SSE']
  },
  {
    label: 'AI & LLMs',
    items: ['Vercel AI SDK', 'OpenAI API', 'LLM tool calling', 'AI agents', 'RAG', 'Agentic workflows']
  },
  {
    label: 'Backend & data',
    items: ['GraphQL', 'REST APIs', 'PostgreSQL', 'SQL', 'Flask', 'Docker', 'Recall.ai API', 'Webhook integrations']
  },
  {
    label: 'Tooling & observability',
    items: ['Datadog', 'LaunchDarkly', 'Sentry', 'Mixpanel', 'Git', 'Vercel', 'AWS', 'GCP']
  },
  {
    label: 'Rich text editors',
    items: ['Quill', 'ProseMirror']
  }
];

export type ResumeEntry = {
  org: string;
  role: string;
  dates: string;
  context?: string;
  stack?: string[];
  bullets: string[];
};

export const experience: ResumeEntry[] = [
  {
    org: 'Tensure Consulting',
    role: 'Senior Software Engineer',
    dates: '2020 – Present',
    context:
      "Consulting practice delivering the Topstep, Product Forge, and Mailchimp engagements below, plus current internal work.",
    bullets: [
      'Deliver full-stack engineering and technical consulting for startup and enterprise clients, working within established production codebases and leading architecture and technical planning.',
      'Partner with founders, product managers, and stakeholders to translate business requirements into production-ready solutions.',
      'Currently on an internal project: diagnosed reliability failures in a HubSpot-to-Ruddr integration — tracing them to strict downstream data-formatting requirements and no automated error recovery, which had been forcing manual intervention to keep resourcing data accurate — and recommended a custom multi-platform resourcing dashboard over the direct integration. Scoping the technical approach now.',
      'Mentor a software engineer on the Product Forge team through structured 1:1s, providing career guidance and technical development support.'
    ]
  },
  {
    org: 'Topstep',
    role: 'Senior Software Engineer',
    dates: 'Sep 2025 – Jul 2026',
    context: 'via Tensure (long-term embedded engagement)',
    stack: ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'GraphQL', 'AWS', 'Datadog', 'LaunchDarkly'],
    bullets: [
      "Contributed to the data model design and helped build the GraphQL API layer and React UI for the Trader Public Profile platform, delivering real-time trade metrics to users.",
      "Ported trade metric computation from Topstep's existing TypeORM-based Node.js implementation into the company's new GraphQL API architecture, working closely with stakeholders to validate calculation accuracy for high-volume trader accounts.",
      'Independently rebuilt user onboarding with route-based workflows, A/B testing via LaunchDarkly feature flags, and Datadog instrumentation to track drop-off at each step — uncovered drop-off at an unexpected step, directly informing the next iteration.'
    ]
  },
  {
    org: 'Product Forge',
    role: 'Senior Full-Stack Engineer',
    dates: 'Jan 2024 – 2025',
    context: 'via Tensure (long-term embedded engagement)',
    stack: ['Next.js', 'React', 'TypeScript', 'Flask', 'PostgreSQL', 'Recall.ai API'],
    bullets: [
      'Architected a three-layer state management system for real-time collaborative editing — Liveblocks for shared document state across concurrent users, TanStack Query for server-persisted state with cache invalidation, and a Context/reducer pattern for local UI state — eliminating a class of stale-state and re-render bugs caused by treating all three as one undifferentiated store.',
      "Contributed to an agentic AI assistant (Vercel AI SDK) that autonomously fetched meeting transcripts, extracted product insights, and updated user stories from a single instruction — building the transcript-chunking logic to fit large meetings within the model's context window, improving tool-selection prompting and artifact-type detection, and adding a coordination layer to prevent the assistant's search tools from executing simultaneously.",
      'Designed and built core backend subsystems for the Flask API — Clerk auth/organization webhooks, request middleware, structured Cloud Run logging, data export, the feedback system, and Mixpanel analytics integration — while authoring 21 database schema migrations.',
      'Built and maintained the API layer bridging a companion Chrome extension to the core backend — bearer-token authentication, Liveblocks real-time sync passthrough, and full artifact/meeting CRUD proxying — sustained across a year of iteration including a first-time-user onboarding flow.',
      'Designed and implemented the original debounced autosave system for the artifact editor, iterating on save timing and reliability across multiple releases to balance responsiveness against write load.'
    ]
  },
  {
    org: 'Mailchimp / Intuit',
    role: 'Software Engineer II',
    dates: 'Jan 2020 – 2023',
    context: 'via Tensure (long-term embedded engagement)',
    stack: ['React', 'TypeScript', 'Redux', 'ProseMirror'],
    bullets: [
      'Before the AI feature, integrated a content-generation engine Mailchimp had acquired into the ProseMirror email editor — an earlier, pre-AI automated content tool that the LLM-based feature later replaced.',
      "Co-led frontend engineering for Mailchimp's first-generation AI content generation feature, shipped to millions of users — one of the earliest AI integrations in the product.",
      'Co-led a team of 3–4 engineers to architect and deliver AI content generation on top of the existing ProseMirror-based email editor, supporting two concurrent editor versions simultaneously.',
      "Extended AI-generated content into Mailchimp's Automation Flows, wiring generated copy into trigger-based automated email sequences beyond the single-email editor.",
      'Partnered with the data analytics team to instrument tracking for new AI-generated content features, establishing feedback loops to measure adoption and inform iteration.',
      'Co-led a migration from SQL to Google Cloud Spanner, learning the then-new technology quickly to help drive the initiative — reducing annual infrastructure costs by $500K through staged migrations and comprehensive regression testing.'
    ]
  },
  {
    org: 'Fugue AI',
    role: 'Co-Founder & Engineering Lead',
    dates: '2022 – 2024',
    context: 'Part-time venture, run alongside consulting work.',
    bullets: [
      'Co-founded an AI creative platform integrating DALL·E and Stable Diffusion image generation models, built full-stack on AWS and shipped to public users; owned every engineering decision end-to-end, from infrastructure and model integration to product prioritization.'
    ]
  }
];

export const education = {
  degree: 'Master of Occupational Therapy',
  school: 'The Ohio State University'
};

export const aboutSummary =
  "Senior Software Engineer with 6 years of production experience specializing in TypeScript and React. I've shipped AI-integrated features at enterprise scale at Mailchimp, built real-time collaborative systems with complex multi-layer state management at Product Forge, and independently rebuilt Topstep's onboarding experience while contributing to its real-time trading analytics platform. I thrive in growth-stage companies where engineers have real ownership over what they build and how they build it.";
