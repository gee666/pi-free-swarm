import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ConfigurationChange } from "../../src/runtime-configuration.js";
import { getConfigurationRevision } from "../../src/store/configuration-revisions.js";
import { getRuntimeConfiguration, queueConfigurationChange } from "../../src/store/runtime-configuration.js";
import { listSwarms } from "../../src/store/swarm-queries.js";
import { isAlive, spawnsOf, waitFor, type RunFixture } from "./run-fixture.js";

const script = fileURLToPath(new URL("./fixtures/configuration-runner.ts", import.meta.url));

export async function configurationOwner(run: RunFixture, count: number, resumeId?: number) {
  const { port, ...settings } = run.env.settings;
  writeFileSync(
    path.join(run.db.dataDir, "settings.json"),
    JSON.stringify({ ...settings, ...(port === null ? {} : { port }) }),
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx/esm",
      script,
      run.cwd,
      String(count),
      resumeId === undefined ? "start" : "resume",
      String(resumeId ?? ""),
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = once(child, "exit");
  let clockWork = Promise.resolve();
  const advance = (milliseconds: number) => {
    const next = clockWork.then(async () => {
      const response = once(child, "message");
      child.send({ advance: milliseconds });
      const message = await Promise.race([
        response,
        exited.then(() => {
          throw new Error(`Owner exited before clock advance: ${stderr}`);
        }),
      ]);
      assert.deepEqual(message[0], { advanced: milliseconds });
    });
    clockWork = next;
    return next;
  };
  try {
    await waitFor(
      () =>
        listSwarms(run.db, Date.now()).some(
          (swarm) => resumeId === undefined || (swarm.id === resumeId && swarm.runCount > 1),
        ),
      `configuration owner starts (${stderr})`,
      15_000,
    );
    const swarmId = resumeId ?? listSwarms(run.db, Date.now())[0].id;
    await advance(0);
    const waitApplied = async (requestId: number) => {
      await advance(50);
      let pumping = false;
      let clockError: unknown;
      await waitFor(
        () => {
          if (clockError) throw clockError;
          const current = getRuntimeConfiguration(run.db, swarmId, Date.now())?.requests.find(
            (item) => item.id === requestId,
          );
          if (current?.status === "rejected") throw new Error(current.error ?? "Configuration request rejected");
          if (current?.status !== "applied" && !pumping && child.connected) {
            pumping = true;
            void advance(0).then(
              () => {
                pumping = false;
              },
              (error: unknown) => {
                clockError = error;
              },
            );
          }
          return current?.status === "applied";
        },
        `configuration request ${requestId} applied (${stderr})`,
        15_000,
      );
    };
    return {
      swarmId,
      advance,
      async applied(change: ConfigurationChange) {
        const request = queueConfigurationChange(
          run.db,
          swarmId,
          "User",
          change,
          getConfigurationRevision(run.db, swarmId),
          Date.now(),
        );
        await waitApplied(request.id);
        return request;
      },
      waitApplied,
      async finished() {
        if (child.connected) child.send({ advance: 25 }, () => undefined);
        await waitFor(() => child.exitCode !== null || child.signalCode !== null, `owner finishes (${stderr})`, 15_000);
        await exited;
        assert.equal(child.exitCode, 0, stderr);
      },
      async close() {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        try {
          await waitFor(
            () => child.exitCode !== null || child.signalCode !== null,
            `owner joins cleanup (${stderr})`,
            10_000,
          );
        } finally {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          await exited;
        }
        await waitFor(() => spawnsOf(run.fake).every(({ pid }) => !isAlive(pid)), "owned child process cleanup", 5_000);
      },
    };
  } catch (error) {
    child.kill("SIGTERM");
    await exited;
    throw error;
  }
}
