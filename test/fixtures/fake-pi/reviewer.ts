export async function runPrintReview(
  run: (prompt: string) => Promise<void>,
  log: (record: Record<string, unknown>) => void,
): Promise<never> {
  const keepAlive = setInterval(() => undefined, 1000);
  let prompt = "";
  for await (const chunk of process.stdin) prompt += String(chunk);
  log({
    fake: "review",
    prompt,
    cwd: process.cwd(),
    swarmEnv: Object.keys(process.env).filter((key) => key.startsWith("PI_SWARM_")),
  });
  await run(prompt);
  clearInterval(keepAlive);
  process.exit(0);
}
