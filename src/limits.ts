// Shared by the broker and the UI counters, so it must stay free of Node imports.

export const TITLE_MAX = 60;
export const TEXT_MAX = 200;
export const MAIN_FEEDBACK_MAX = 2000;

export type LimitCheck = { ok: true; value: string } | { ok: false; error: string };

/** Counts code points, like SQLite `length()`, so the counter and the CHECK constraints agree. */
export function charCount(text: string): number {
  return Array.from(text).length;
}

/** Validates the trimmed text; on success `value` is what gets stored. */
export function checkText(raw: string, max: number = TEXT_MAX): LimitCheck {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, error: "Text is empty." };
  const count = charCount(value);
  if (count > max) {
    return { ok: false, error: `Too long: ${count}/${max} characters. Shorten it or point to a file path.` };
  }
  return { ok: true, value };
}

export function checkTitle(raw: string): LimitCheck {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, error: "Title is empty." };
  const count = charCount(value);
  if (count > TITLE_MAX) return { ok: false, error: `Title too long: ${count}/${TITLE_MAX} characters. Shorten it.` };
  return { ok: true, value };
}
