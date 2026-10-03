import type { FieldName } from './schema';

export function errorId(field: FieldName) {
  return `beta-error-${field}`;
}

export function describedBy(...ids: (string | false | undefined)[]) {
  return ids.filter(Boolean).join(' ') || undefined;
}

/** Per-control error text. Never colour alone: an icon and bold weight
 *  carry it too, and the control gets aria-invalid. */
export function FieldError({ field, message }: { field: FieldName; message?: string }) {
  if (!message) return null;
  return (
    <p id={errorId(field)} className="beta-field-error">
      <span aria-hidden="true" className="beta-field-error-mark">
        !
      </span>
      <span>{message}</span>
    </p>
  );
}

/**
 * Move focus to a container the visitor cannot reach with Tab.
 *
 * The tabindex is added for the focus and removed on blur. A permanent one
 * makes the container the nearest focusable ancestor, and Safari focuses it
 * instead of a clicked radio — which put the focus ring on the whole card.
 * The ring keys off :focus, not :focus-visible, because programmatic focus
 * does not match the latter.
 */
export function focusContainer(el: HTMLElement | null, options?: FocusOptions) {
  if (!el) return;
  el.setAttribute('tabindex', '-1');
  el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
  el.focus(options);
}
