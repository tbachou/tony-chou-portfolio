import { Topic } from '@/lib/api';

interface TopicPickerProps {
  topics: Topic[];
  onSelect: (topic: Topic) => void;
  disabled?: boolean;
}

export function TopicPicker({ topics, onSelect, disabled }: TopicPickerProps) {
  return (
    <div>
      <p className="text-term-sm text-term-muted">
        <span aria-hidden="true">$ </span>
        ls topics/
      </p>
      <p className="mt-1 text-term-xs text-term-muted">Each one is grounded in a specific, verified piece of work.</p>

      <ul className="mt-4 divide-y divide-term-border border border-term-border">
        {topics.map((topic, index) => (
          <li key={topic.id}>
            <button
              type="button"
              onClick={() => onSelect(topic)}
              disabled={disabled}
              className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-term-instant hover:bg-term-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="mt-0.5 shrink-0 text-term-sm tabular-nums text-term-muted">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-term-base text-term-ink">{topic.label}</span>
                <span className="block text-term-sm text-term-muted">{topic.description}</span>
              </span>
              <span
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-term-sm text-term-muted opacity-0 transition-opacity duration-term-instant group-hover:text-term-accent group-hover:opacity-100"
              >
                run →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
