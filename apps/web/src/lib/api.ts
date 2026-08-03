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

export async function fetchStories(): Promise<Story[]> {
  const res = await fetch(`${API_URL}/stories`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch stories: ${res.status}`);
  return res.json();
}

export async function fetchNextTurn(
  history: ConversationTurn[],
  topicId?: string
): Promise<ConversationTurn[]> {
  const res = await fetch(`${API_URL}/conversation/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history, topicId })
  });
  if (!res.ok) throw new Error(`Failed to fetch next turn: ${res.status}`);
  return res.json();
}
