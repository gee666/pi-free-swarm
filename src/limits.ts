// Shared by the broker and the UI counters, so it must stay free of Node imports.

export const TITLE_MAX = 60;
export const WORK_TITLE_ACCEPTED = 100;
export const WORK_TEXT_ACCEPTED = 300;
/** Stated agent text limit; accepted limits allow counting errors. */
export const TEXT_MAX = 200;
export const MAIN_FEEDBACK_MAX = 4000;
export const USER_BODY_PREVIEW_CHARS = 200;

export type LimitCheck = { ok: true; value: string } | { ok: false; error: string };

/** Counts code points, like SQLite `length()`, so the counter and the CHECK constraints agree. */
export function charCount(text: string): number {
  return Array.from(text).length;
}

/** Cuts `text` so that `head suffix` fits in `max` code points. */
export function clipWithSuffix(text: string, suffix: string, max: number): string {
  const room = max - 1 - charCount(suffix);
  const chars = Array.from(text);
  const head = chars.length <= room ? text : chars.slice(0, room).join("").trimEnd();
  return `${head} ${suffix}`;
}

/** Validates the trimmed text; on success `value` is what gets stored. */
export function checkText(raw: string, max: number = TEXT_MAX): LimitCheck {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, error: "Text is empty." };
  if (max === Number.POSITIVE_INFINITY) return { ok: true, value };
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
  if (count > WORK_TITLE_ACCEPTED)
    return {
      ok: false,
      error: `Title too long (${count} chars): keep it under ${TITLE_MAX}; put long material in a file and reference its path.`,
    };
  return { ok: true, value };
}
