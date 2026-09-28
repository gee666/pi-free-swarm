// Shared by the broker and the UI counters, so it must stay free of Node imports.

export const TITLE_MAX = 60;
/** Default stated body limit: what agents and the UI are told (`bodyMaxChars`). */
export const TEXT_MAX = 200;
export const BODY_STATED_MIN = 100;
/** Matches the body CHECK constraints. */
export const BODY_SAFETY_MAX = 16000;
export const MAIN_FEEDBACK_MAX = 4000;

export type LimitCheck = { ok: true; value: string } | { ok: false; error: string };

/** Counts code points, like SQLite `length()`, so the counter and the CHECK constraints agree. */
export function charCount(text: string): number {
  return Array.from(text).length;
}

/**
 * Bodies up to this are stored as-is. Twice the stated limit absorbs agents' miscounting, which otherwise
 * cost a rejected write and a retry turn; it is never shown to agents.
 */
export function bodyCeiling(stated: number): number {
  return Math.min(2 * stated, BODY_SAFETY_MAX);
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
