import type { FieldName } from './schema';

export function errorId(field: FieldName) {
  return `beta-error-${field}`;
}

export function describedBy(...ids: (string | false | undefined)[]) {
  return ids.filter(Boolean).join(' ') || undefined;
}

/** Persistent, per-control error text. Never colour alone: it carries an
 *  icon and bold weight too, and the control gets aria-invalid. */
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
 * The tabindex is applied for the duration of the focus and removed on blur,
 * rather than living in the markup. A permanent tabindex="-1" makes the
 * container the nearest focusable ancestor of everything inside it, and a
 * browser that declines to focus the control that was clicked focuses that
 * ancestor instead. Safari does exactly that for radios and checkboxes, so
 * every click on a choice in the form put focus on the <form> and lit the
 * whole card with the .beta-focus-target:focus ring.
 *
 * Focus still has to be visible wherever script puts it, which is why that
 * ring keys off :focus rather than :focus-visible — programmatic focus does
 * not match :focus-visible. Keeping the container unfocusable until the
 * moment it is focused is what stops a click from borrowing that ring.
 */
export function focusContainer(el: HTMLElement | null, options?: FocusOptions) {
  if (!el) return;
  el.setAttribute('tabindex', '-1');
  el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
  el.focus(options);
}
