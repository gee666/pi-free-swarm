
## Code quality bar

Applies to every newly written or rewritten piece of code, in all repos. Reviewers check these on top of "does it work":

- **No dead code.** Unused, unreachable or half-wired code is deleted or properly wired in. Nothing is kept "just in case".
- **Clean, logical architecture.** Each piece lands in the layer and repo where it belongs (core IR vs extension pack vs BFF vs front). No logic smuggled into controllers, entities, config or components.
- **No senseless duplication.** Shared behaviour is extracted, not copy-pasted to change three lines. Intentional duplication needs one line saying why.
- **No controversial one-offs.** Follow the patterns already used in that repo. A new library, style or paradigm is a decision to raise, not to slip in.
- **Comments and docs earn their place.** Remove stale or obvious ones; what stays is short, focused, human-readable and explains *why*, not what the signature already says. No AI slop, no changelogs in comments. Write them with the `upslop` and `write prompts` skills.
- **No crutches.** No magic numbers, URLs, model names, thresholds or prompts hardcoded where configuration belongs (`dev/.env`, `application*.yml`, front env). No sleeps, retries or catch-all handlers papering over a real bug.
- **Clean TypeScript** (RAM_front, RAM_bff): well-thought, meaningful types; no `any`, no casts or `@ts-ignore`/`@ts-expect-error` to silence the compiler, no `!` to skip a real check. Build and lint stay warning-free.
- **Nothing overgrown.** Max 350 lines per file; functions and classes do one thing. Beyond that, split it — unless the file is genuinely cohesive and splitting hurts, and the PR says so.
