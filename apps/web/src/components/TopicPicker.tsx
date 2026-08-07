import { Topic } from '@/lib/api';

interface TopicPickerProps {
  topics: Topic[];
  onSelect: (topic: Topic) => void;
  disabled?: boolean;
}

export function TopicPicker({ topics, onSelect, disabled }: TopicPickerProps) {
  return (
    <div>
      <h2 className="text-base font-semibold text-foreground">Choose a topic to begin</h2>
      <p className="mt-1 text-sm text-muted">
        Each one is grounded in a specific, verified piece of work.
      </p>

      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {topics.map((topic, index) => (
          <li key={topic.id}>
            <button
              type="button"
              onClick={() => onSelect(topic)}
              disabled={disabled}
              className="group flex h-full w-full flex-col items-start gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-left transition-all duration-150 hover:border-interviewer/50 hover:bg-white/[0.05] focus-visible:border-interviewer focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-xs tabular-nums text-muted">{String(index + 1).padStart(2, '0')}</span>
              <span className="font-medium text-foreground">{topic.label}</span>
              <span className="text-sm text-muted">{topic.description}</span>
              <span className="mt-auto flex items-center gap-1 pt-1 text-xs font-medium text-interviewer opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                Start this interview
                <span aria-hidden="true">→</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
