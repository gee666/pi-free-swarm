export interface MentionSpan {
  start: number;
  end: number;
  name: string;
}

export function mentionSpans(text: string, names: readonly string[]): MentionSpan[] {
  const participants = new Map(names.map((name) => [name.toLowerCase(), name]));
  return Array.from(text.matchAll(/(?<![\p{L}\p{N}_@])@([\p{L}\p{N}_]+)(?![\p{L}\p{N}_])/gu)).flatMap((match) => {
    const name = participants.get(match[1].toLowerCase());
    return name === undefined ? [] : [{ start: match.index, end: match.index + match[0].length, name }];
  });
}

export function mentionedNames(text: string, names: readonly string[]): string[] {
  return [...new Set(mentionSpans(text, names).map((mention) => mention.name))];
}
