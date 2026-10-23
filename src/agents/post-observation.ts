/** Process-local proof of full post payloads entering context, independent of queue acceptance. */
export class PostObservation {
  private readonly prompts = new Map<string, { ids: Set<number>; copies: number }>();

  sent(text: string, postIds: readonly number[] | undefined): void {
    if (!postIds?.length) return;
    const proof = this.prompts.get(text) ?? { ids: new Set<number>(), copies: 0 };
    for (const id of postIds) proof.ids.add(id);
    proof.copies++;
    this.prompts.set(text, proof);
  }

  rejected(text: string): void {
    this.cancelQueued(new Map([[text, 1]]));
  }

  cancelQueued(texts: ReadonlyMap<string, number>): void {
    for (const [text, count] of texts) {
      const proof = this.prompts.get(text);
      if (!proof || count <= 0) continue;
      proof.copies -= count;
      if (proof.copies <= 0) this.prompts.delete(text);
    }
  }

  observed(text: string): number[] {
    const ids = new Set<number>();
    for (const [sentText, proof] of this.prompts) {
      // Match full payloads, not ID-like markers quoted inside another post's body.
      if (!text.includes(sentText)) continue;
      this.prompts.delete(sentText);
      for (const id of proof.ids) ids.add(id);
    }
    return [...ids];
  }
}
