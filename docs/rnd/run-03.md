# Run 03 — four peers, GPT-6 Astra

**Outcome: incomplete. The $50 success target is not met.**

## Configuration and provenance

- Swarm 3, `rnd-01-four-peers`, one invocation; no parent repair/resume.
- Extension `d455511`, plus the preserved pre-existing local activation/RPC/package changes. Exact dirty patch and launch command: modernization project `.rnd/experiment-01/`.
- Four equal peers, medium thinking, original requirements and fresh `java_project/`. No roles or implementation plan. `pi -ne -e <checkout> -e npm:oira666_pi-limits-wait --swarm --approve`.
- Actual worker usage: only `gpt-6-astra`; no fallback recorded. Earlier output preserved in `java_project-baseline/`.

## Measurements

| Metric | Result |
| --- | ---: |
| Worker cost | $22.773196 |
| Parent cost | $0.059332 |
| Combined cost | **$22.832528** |
| Elapsed swarm time | **15m 01.218s** |
| Summed active agent time | 52m 12.768s |
| Assistant turns | 337 |
| Uncached input tokens | 334,956 |
| Output tokens | 65,306 |
| Cache-read tokens | 16,158,336 |
| Cache-write tokens | 0 |
| Coordination-only turns / cost | 125 / $8.196110 |
| Length-limit rejections | **0** |
| Wall reads / delta reads | 9 / **0** |
| Posts / messages | 8 / 98 |
| Revives / acceptance challenges | 0 / 0 |

Coordination-only cost is whole-turn attribution, not proof of waste. Session and database worker totals reconcile. Metrics are reproducible with `scripts/rnd-metrics.py` and retained in `.rnd/experiment-01/metrics.json`.

## Independent outcome check

Reran the delivered `test.sh` with the documented JDK: build and four Java unit programs pass; **15/16 differential scenarios pass; command exits 1**. `darkness_death` has matching stdout/status but 454 native stderr bytes versus no Java stderr. EOF/record diagnostic behavior is knowingly missing. Broader branch, malformed-data and endgame validation is also unproven.

The independent rebuild reproduces JAR SHA-256 `38302633378c5be9ff41c37fc8b3702ce7cae058b6259fc35507d0b9d17b5966`. Original instructions and supplied artifacts retain their recorded hashes. Log: `.rnd/experiment-01/independent-test.log`.

## What changed in behavior

The four peers spontaneously divided build/validation, parsing/input, actions and engine/lifecycle. They found and repaired real interactions: LOG behavior, input encoding, CR/partial records and streaming startup. There was no assigned coordinator. Communication no longer failed at 200 characters; however, no peer used the new delta cursor, so it cannot explain savings. One concurrent build collision was reported.

The acceptance tool made the outcome explicit but did not cause repair. Ten acceptance calls included no challenges. Because peers voluntarily recorded `incomplete`, the bounded unchecked-task wakeup did not fire. That is the implemented policy, not a lost notification.

Most importantly, a tentative claim that native traces could not legitimately be reproduced became shared policy again. The requirement was **not forgotten**: peers repeatedly saw it, retained a red test, and stopped with it unresolved. A passive task board would merely record that same decision. There is still no demonstrated contradiction in the original requirements; see the diagnostic-contract investigation.

## Interpretation and next experiment

This run costs much less than the historical $132.73 worker baseline, but both fail acceptance and their validation scope differs substantially. It is not a quality-preserving efficiency win.

Next: one serial, fresh four-peer run starting on Opus medium, with unchanged mechanics and requirements. This tests whether the stopping behavior depends on the starting model before adding workflow machinery. If it recurs, evaluate bounded actionable-gap handoffs: findings retain provenance and a concrete next probe, rather than becoming terminal merely because they were documented. No general task board or mandatory review quorum yet.
