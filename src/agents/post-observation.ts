/** Process-local proof of full post payloads entering context, independent of queue acceptance. */
export class PostObservation {
  private readonly prompts = new Map<string, readonly number[]>();

  sent(text: string, postIds: readonly number[] | undefined): void {
    if (postIds?.length) this.prompts.set(text, postIds);
  }

  rejected(text: string): void {
    this.prompts.delete(text);
  }

  observed(text: string): number[] {
    const ids = new Set<number>();
    for (const [sentText, postIds] of this.prompts) {
      // Match full payloads, not ID-like markers quoted inside another post's body.
      if (!text.includes(sentText)) continue;
      this.prompts.delete(sentText);
      for (const id of postIds) ids.add(id);
    }
    return [...ids];
  }
}
