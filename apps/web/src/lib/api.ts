const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type ConversationTurn = {
  role: 'interviewer' | 'tony';
  text: string;
};

export type Story = {
  id: string;
  title: string;
  ownership: 'solo' | 'contributed' | 'co-led';
  engagement: string;
  summary: string;
};

export type Topic = {
  id: string;
  slug: string;
  label: string;
  description: string;
};

export type UsageSummary = {
  dailyTotals: { date: string; turnCount: number; tokenCount: number }[];
  topSources: { hashedIp: string; tokenCount: number }[];
};

export async function fetchStories(): Promise<Story[]> {
  const res = await fetch(`${API_URL}/stories`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch stories: ${res.status}`);
  return res.json();
}

export async function fetchTopics(): Promise<Topic[]> {
  const res = await fetch(`${API_URL}/topics`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch topics: ${res.status}`);
  return res.json();
}

export async function fetchUsageSummary(): Promise<UsageSummary> {
  const res = await fetch(`${API_URL}/internal/usage/summary`, {
    cache: 'no-store',
    credentials: 'include'
  });
  if (!res.ok) throw new Error(`Failed to fetch usage summary: ${res.status}`);
  return res.json();
}

export type SseTurnEvent =
  | { type: 'turn_start'; role: 'interviewer' | 'tony' }
  | { type: 'token'; text: string }
  | { type: 'turn_end'; conversationId: string; turnIndex: number; isFinal: boolean }
  | { type: 'turn_error'; message: string };

/**
 * Consumes POST /conversation/turn's SSE stream as it arrives. Yields one
 * event per `event:`/`data:` block; the caller drives its own UI state off
 * each event rather than waiting for a single final response.
 *
 * The transcript is deliberately NOT sent: the API rebuilds it from its own
 * persisted turns for `conversationId` (spec 0012 phase one). The contract is
 * `.strict()`, so sending one is a 400.
 */
export async function* streamNextTurn(params: {
  topicId: string;
  conversationId?: string;
}): AsyncGenerator<SseTurnEvent> {
  const res = await fetch(`${API_URL}/conversation/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to start turn: ${res.status} ${body}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      if (!block.trim()) continue;
      let eventName = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) data = line.slice(5).trim();
      }
      if (!data) continue;
      yield { type: eventName, ...JSON.parse(data) } as SseTurnEvent;
    }
  }
}
