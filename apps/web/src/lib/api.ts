const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type AppSlug = 'panel' | 'carryover';

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

export type AccessRequestStatus = 'pending' | 'approved' | 'denied';

export type AccessRequestStatusResult = {
  status: AccessRequestStatus;
  downloadUrl: string | null;
};

export type AccessRequestAdmin = {
  id: string;
  email: string;
  appSlug: string;
  status: AccessRequestStatus;
  downloadUrl: string | null;
  createdAt: string;
};

export async function requestAccess(
  email: string,
  appSlug: AppSlug
): Promise<AccessRequestStatusResult> {
  const res = await fetch(`${API_URL}/access-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, appSlug })
  });
  if (!res.ok) throw new Error(`Failed to request access: ${res.status}`);
  return res.json();
}

// null means no request exists yet for that email+app (the endpoint 404s) —
// distinct from a "pending" request, which does exist.
export async function fetchAccessRequestStatus(
  email: string,
  appSlug: AppSlug
): Promise<AccessRequestStatusResult | null> {
  const params = new URLSearchParams({ email, appSlug });
  const res = await fetch(`${API_URL}/access-requests/status?${params}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch access request status: ${res.status}`);
  return res.json();
}

export async function fetchAccessRequests(): Promise<AccessRequestAdmin[]> {
  const res = await fetch(`${API_URL}/internal/access-requests`, {
    cache: 'no-store',
    credentials: 'include'
  });
  if (!res.ok) throw new Error(`Failed to fetch access requests: ${res.status}`);
  return res.json();
}

export async function approveAccessRequest(
  id: string,
  downloadUrl: string
): Promise<AccessRequestAdmin> {
  const res = await fetch(`${API_URL}/internal/access-requests/${id}/approve`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ downloadUrl })
  });
  if (!res.ok) throw new Error(`Failed to approve request: ${res.status}`);
  return res.json();
}

export async function denyAccessRequest(id: string): Promise<AccessRequestAdmin> {
  const res = await fetch(`${API_URL}/internal/access-requests/${id}/deny`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!res.ok) throw new Error(`Failed to deny request: ${res.status}`);
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
 */
export async function* streamNextTurn(params: {
  topicId: string;
  conversationId?: string;
  history: ConversationTurn[];
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
