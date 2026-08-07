'use client';

import { useEffect, useRef, useState } from 'react';
import { ConversationTurn, Topic, fetchTopics, streamNextTurn } from '@/lib/api';
import { TerminalWindow } from './TerminalWindow';
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
    <TerminalWindow path={topic ? `tonychou@portfolio:~/interview/${topic.slug}$` : 'tonychou@portfolio:~/interview$'}>
      {panelState.status === 'loading-topics' ? (
        <p className="text-term-sm text-term-muted" role="status" aria-live="polite">
          LOADING TOPICS<span className="terminal-cursor" aria-hidden="true" />
        </p>
      ) : panelState.status === 'topics-error' ? (
        <p className="text-term-sm text-term-error" role="alert">
          !! {panelState.message}
        </p>
      ) : panelState.status === 'idle' && !topic ? (
        <TopicPicker topics={panelState.topics} onSelect={handleSelectTopic} />
      ) : (
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-term-sm text-term-muted">
              <span aria-hidden="true">$ </span>
              {topic?.label}
            </p>
            {panelState.status !== 'concluded' ? (
              <button
                type="button"
                onClick={handleRestart}
                className="shrink-0 text-term-xs text-term-muted underline decoration-term-border underline-offset-4 transition-colors duration-term-instant hover:text-term-ink"
              >
                [ change topic ]
              </button>
            ) : null}
          </div>

          <div
            className="mt-4 max-h-[55vh] space-y-5 overflow-y-auto border-t border-term-border pt-5"
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

          <div className="mt-5 border-t border-term-border pt-5">
            {panelState.status === 'awaiting-advance' ? (
              <button
                type="button"
                onClick={handleAdvance}
                className="inline-flex min-h-[44px] items-center gap-2 border border-term-border px-4 py-2 text-term-base text-term-ink transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent"
              >
                [ continue the interview → ]
              </button>
            ) : panelState.status === 'concluded' ? (
              <div className="flex flex-wrap items-center gap-4">
                <p className="text-term-sm text-term-muted">That&rsquo;s the end of this topic.</p>
                <button
                  type="button"
                  onClick={handleRestart}
                  className="inline-flex min-h-[44px] items-center border border-term-border px-4 py-2 text-term-sm text-term-ink transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent"
                >
                  [ pick another topic ]
                </button>
              </div>
            ) : panelState.status === 'turn-error' ? (
              <div className="flex flex-wrap items-center gap-4" role="alert">
                <p className="text-term-sm text-term-error">!! {panelState.message}</p>
                <button
                  type="button"
                  onClick={handleAdvance}
                  className="inline-flex min-h-[44px] items-center border border-term-border px-4 py-2 text-term-sm text-term-ink transition-colors duration-term-instant hover:border-term-accent hover:text-term-accent"
                >
                  [ retry ]
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </TerminalWindow>
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
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-term-canvas ${isInterviewer ? 'bg-interviewer' : 'bg-tony'}`}
        aria-hidden="true"
      >
        {isInterviewer ? 'IV' : 'T'}
      </span>
      <div>
        <p className={`text-term-xs ${isInterviewer ? 'text-interviewer' : 'text-tony'}`}>{ROLE_LABEL[role]}</p>
        <p className="mt-1 text-term-sm leading-relaxed text-term-body">
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
