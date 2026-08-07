'use client';

import { useEffect, useRef, useState } from 'react';
import { ConversationTurn, Topic, fetchTopics, streamNextTurn } from '@/lib/api';
import { TopicPicker } from './TopicPicker';

type PanelState =
  | { status: 'loading-topics' }
  | { status: 'topics-error'; message: string }
  | { status: 'idle'; topics: Topic[] }
  | { status: 'streaming'; role: 'interviewer' | 'tony' }
  | { status: 'awaiting-advance' }
  | { status: 'concluded' }
  | { status: 'turn-error'; message: string };

const ROLE_LABEL: Record<'interviewer' | 'tony', string> = {
  interviewer: 'Interviewer',
  tony: 'Tony (AI)'
};

export function ConversationPanel() {
  const [panelState, setPanelState] = useState<PanelState>({ status: 'loading-topics' });
  const [topic, setTopic] = useState<Topic | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [transcript, setTranscript] = useState<ConversationTurn[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  // Avoids a stale closure over streamingText inside the async generator loop.
  const streamingTextRef = useRef('');
  // Synchronous re-entrancy guard: blocks a second runTurn (a double click,
  // or React invoking a handler more than once) from firing a second,
  // concurrent /conversation/turn call while one is already in flight.
  const isBusyRef = useRef(false);

  useEffect(() => {
    fetchTopics()
      .then((topics) => setPanelState({ status: 'idle', topics }))
      .catch(() => setPanelState({ status: 'topics-error', message: 'Could not load topics.' }));
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [transcript, streamingText]);

  async function runTurn(selectedTopic: Topic, history: ConversationTurn[], forConversationId?: string) {
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    let currentRole: 'interviewer' | 'tony' | null = null;

    // Snapshots role/text into their own const bindings before queuing the
    // state update. currentRole is a mutable `let` reassigned immediately
    // after this is called; a closure over it directly (rather than a
    // snapshot) would read whatever it's been reassigned to by the time
    // React actually runs the updater, committing the wrong role.
    function commitCurrentTurn() {
      if (!currentRole) return;
      const role = currentRole;
      const text = streamingTextRef.current;
      setTranscript((prev) => [...prev, { role, text }]);
    }

    try {
      for await (const event of streamNextTurn({
        topicId: selectedTopic.slug,
        conversationId: forConversationId,
        history
      })) {
        if (event.type === 'turn_start') {
          commitCurrentTurn(); // the previous turn in this pair, if any
          currentRole = event.role;
          streamingTextRef.current = '';
          setStreamingText('');
          setPanelState({ status: 'streaming', role: event.role });
        } else if (event.type === 'token') {
          streamingTextRef.current += event.text;
          setStreamingText(streamingTextRef.current);
        } else if (event.type === 'turn_end') {
          commitCurrentTurn();
          currentRole = null;
          streamingTextRef.current = '';
          setStreamingText('');
          setConversationId(event.conversationId);
          setPanelState(event.isFinal ? { status: 'concluded' } : { status: 'awaiting-advance' });
        } else if (event.type === 'turn_error') {
          setPanelState({ status: 'turn-error', message: event.message });
        }
      }
    } catch {
      setPanelState({ status: 'turn-error', message: 'Lost connection to the interview. Try again.' });
    } finally {
      isBusyRef.current = false;
    }
  }

  function handleSelectTopic(selected: Topic) {
    setTopic(selected);
    setTranscript([]);
    setConversationId(undefined);
    void runTurn(selected, []);
  }

  function handleAdvance() {
    if (!topic) return;
    void runTurn(topic, transcript, conversationId);
  }

  function handleRestart() {
    setPanelState({ status: 'loading-topics' });
    setTopic(null);
    setTranscript([]);
    setConversationId(undefined);
    fetchTopics()
      .then((topics) => setPanelState({ status: 'idle', topics }))
      .catch(() => setPanelState({ status: 'topics-error', message: 'Could not load topics.' }));
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
      {panelState.status === 'loading-topics' ? (
        <div className="p-6 sm:p-8">
          <p className="text-sm text-muted" role="status" aria-live="polite">
            Loading topics&hellip;
          </p>
        </div>
      ) : panelState.status === 'topics-error' ? (
        <div className="p-6 sm:p-8">
          <p className="text-sm text-red-400" role="alert">
            {panelState.message}
          </p>
        </div>
      ) : panelState.status === 'idle' && !topic ? (
        <div className="p-6 sm:p-8">
          <TopicPicker topics={panelState.topics} onSelect={handleSelectTopic} />
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.02] px-6 py-4 sm:px-8">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{topic?.label}</p>
              <h2 className="mt-0.5 text-base font-semibold text-foreground">Live interview</h2>
            </div>
            {panelState.status !== 'concluded' ? (
              <button
                type="button"
                onClick={handleRestart}
                className="shrink-0 text-xs text-muted underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
              >
                Change topic
              </button>
            ) : null}
          </div>

          <div
            className="max-h-[55vh] space-y-5 overflow-y-auto px-6 py-6 sm:px-8"
            aria-live="polite"
            aria-label="Interview transcript"
          >
            {transcript.map((turn, index) => (
              <TranscriptLine key={index} role={turn.role} text={turn.text} />
            ))}
            {panelState.status === 'streaming' ? (
              <TranscriptLine role={panelState.role} text={streamingText} isStreaming />
            ) : null}
            <div ref={transcriptEndRef} />
          </div>

          <div className="border-t border-white/10 bg-white/[0.02] px-6 py-5 sm:px-8">
            {panelState.status === 'awaiting-advance' ? (
              <button
                type="button"
                onClick={handleAdvance}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-interviewer px-5 py-2.5 text-sm font-medium text-black transition-colors hover:bg-interviewer/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-interviewer"
              >
                Continue the interview
                <span aria-hidden="true">→</span>
              </button>
            ) : panelState.status === 'concluded' ? (
              <div className="flex flex-wrap items-center gap-4">
                <p className="text-sm text-muted">That&rsquo;s the end of this topic.</p>
                <button
                  type="button"
                  onClick={handleRestart}
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-white/15 px-4 py-2 text-sm text-foreground transition-colors hover:border-white/30 hover:bg-white/5"
                >
                  Pick another topic
                </button>
              </div>
            ) : panelState.status === 'turn-error' ? (
              <div className="flex flex-wrap items-center gap-4" role="alert">
                <p className="text-sm text-red-400">{panelState.message}</p>
                <button
                  type="button"
                  onClick={handleAdvance}
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-white/15 px-4 py-2 text-sm text-foreground transition-colors hover:border-white/30 hover:bg-white/5"
                >
                  Retry
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function TranscriptLine({
  role,
  text,
  isStreaming
}: {
  role: 'interviewer' | 'tony';
  text: string;
  isStreaming?: boolean;
}) {
  const isInterviewer = role === 'interviewer';
  return (
    <div className="flex gap-3">
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-black ${isInterviewer ? 'bg-interviewer' : 'bg-tony'}`}
        aria-hidden="true"
      >
        {isInterviewer ? 'IV' : 'T'}
      </span>
      <div>
        <p className={`text-xs font-medium ${isInterviewer ? 'text-interviewer' : 'text-tony'}`}>
          {ROLE_LABEL[role]}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-foreground">
          {text}
          {isStreaming ? (
            <span
              className={`ml-0.5 inline-block h-3.5 w-1.5 animate-pulse ${isInterviewer ? 'bg-interviewer' : 'bg-tony'}`}
              aria-hidden="true"
            />
          ) : null}
        </p>
      </div>
    </div>
  );
}
