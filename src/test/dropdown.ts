import { fireEvent, within } from "@testing-library/react";

/**
 * Drive a Dropdown the way a user does: open the trigger, click the row.
 * `trigger` is the combobox button (from `getByRole("combobox")` or
 * `getByLabelText`); `value` is the option's value.
 */
export function pickOption(trigger: HTMLElement, value: string): void {
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  const listId = trigger.getAttribute("aria-controls");
  const list = listId ? document.getElementById(listId) : null;
  if (!list) throw new Error("Dropdown did not open");
  const row = list.querySelector<HTMLElement>(`[role="option"][data-value="${CSS.escape(value)}"]`);
  if (!row) {
    const have = within(list).queryAllByRole("option").map((o) => o.getAttribute("data-value"));
    throw new Error(`No option with value "${value}"; have ${JSON.stringify(have)}`);
  }
  fireEvent.click(row);
}

/** The values a Dropdown offers, in order, opening and closing it to look. */
export function optionValues(trigger: HTMLElement): string[] {
  const wasOpen = trigger.getAttribute("aria-expanded") === "true";
  if (!wasOpen) fireEvent.click(trigger);
  const listId = trigger.getAttribute("aria-controls");
  const list = listId ? document.getElementById(listId) : null;
  const values = list ? within(list).queryAllByRole("option").map((o) => o.getAttribute("data-value") ?? "") : [];
  if (!wasOpen) fireEvent.click(trigger);
  return values;
}
