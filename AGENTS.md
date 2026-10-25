
## Repository synchronization

- Before starting any work, pull the latest changes from `origin` with `git pull --ff-only`. Preserve local edits; stop and resolve safely if the pull is blocked.
- After each completed, validated piece of work, commit your changes and push to `origin` immediately. Work happens on multiple machines; do not leave finished work unsynchronized.

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

# Repository instructions

The original instructions above remain in force. The guidance below maps their cross-project examples to this TypeScript/Node repository. Use the available `unslop` and `write-prompts` skills in place of the older skill names above.

## Pi compatibility and releases

- Test only against the latest npm Pi release. Do not maintain an older-version test matrix or claim compatibility with an untested minimum.
- Before each release, run `npm test`. Its `pretest` hook installs every directly used Pi SDK package at `@latest` with `--save-dev --ignore-scripts`, then runs `npm run typecheck`. Keep typechecking independent of tests so the hooks cannot recurse.
- After the checks pass, keep one standalone README line in exactly this form: `Tested against Pi <actual version>`. Replace the placeholder with the installed, successfully tested `@earendil-works/pi-coding-agent` version. Update it on every release; never claim a failed run as tested.
- Keep the Pi `peerDependencies` ranges in `package.json` aligned with the README's supported Pi baseline. The current tested baseline must be at least `>=1.4.0`, not an untested `>=1.0.0`. Update the Pi development dependencies and lockfile together.
- Standalone UI tests also refresh Pi and typecheck through `pretest:ui`. After UI changes, rebuild and commit `ui_dist/` with the source changes.
- Run all available repository checks before committing or releasing. If any fail, report the failure and do not publish.

## Code quality bar

Apply this to all new or rewritten code. Review correctness and these requirements:

- Delete unused, unreachable and half-wired code, or wire it in properly. Do not keep code "just in case".
- Keep clear TypeScript/Node boundaries between extension registration, agent execution, persistence, protocol validation and UI. Put behavior in its owning layer, not in configuration or entry points.
- Use the simplest solution that fixes the root cause. Do not hide bugs with sleeps, blind retries, catch-all handlers or compiler suppression.
- Extract genuinely shared behavior instead of copying it to change a few lines. Explain intentional duplication briefly.
- Follow existing repository patterns. Discuss a new dependency, architecture or coding style before introducing it.
- Keep configurable URLs, model names, thresholds and prompts in the repository's typed settings or environment handling. Name fixed protocol constants. Never commit secrets or expose credentials in logs, fixtures or docs.
- Use strict, meaningful types. Validate untrusted JSON, files, environment values and process messages at runtime. No `any`, unsafe casts, `@ts-ignore`, `@ts-expect-error` or non-null assertions to avoid a real check.
- Keep files focused and under 350 lines. Functions and classes should do one job. Exceed the limit only when the code is genuinely cohesive and splitting it would hurt; document the reason in the change review.
- Keep comments and docs short, accurate and human-readable. Explain why when it is not obvious. Remove stale or redundant text and comment changelogs. Use the `unslop` and `write-prompts` skills when available for docs and prompts.
- Add focused regression tests for changed behavior. Run tests, typechecking, formatting and any lint/build/package checks available in `package.json`. Keep those checks warning-free; do not add a lint tool solely to satisfy this instruction.
