// Child process for the multi-process test: argv = dbPath swarmId author peer lockstepWrites burstWrites.
// Phase 1 (lockstep): write only while not ahead of the peer, so both processes are provably live and
// interleaved whatever the scheduler does; at equal counts both race for the write lock. Phase 2 (burst):
// write freely, hammering the lock at the same time as the peer.
import { setTimeout as sleep } from "node:timers/promises";
import { sendMessage } from "../../../src/broker/messages.js";
import { createPost } from "../../../src/broker/wall.js";
import { openSwarmDb } from "../../../src/store/db.js";

const PEER_WAIT_LIMIT_MS = 90_000;
const [dbPath, swarmArg, author, peer, lockstepArg, burstArg] = process.argv.slice(2);
const swarmId = Number(swarmArg);
const db = openSwarmDb(dbPath, { create: false });
const writesOf = db.sql.prepare(
  "SELECT (SELECT COUNT(*) FROM posts WHERE author = ?1) + (SELECT COUNT(*) FROM messages WHERE sender = ?1) AS n",
);
const countOf = (name: string): number => Number(writesOf.get(name)?.n);

function write(i: number): void {
  if (i % 2 === 0) createPost(db, swarmId, author, { title: `${author} ${i}`, text: "concurrent" }, Date.now());
  else sendMessage(db, swarmId, author, ["User", "Liam"], `${author} ${i}`, Date.now());
}

const lockstep = Number(lockstepArg);
const deadline = Date.now() + PEER_WAIT_LIMIT_MS;
for (let i = 0; i < lockstep; i++) {
  while (countOf(peer) < i) {
    if (Date.now() > deadline) throw new Error(`${author}: ${peer} stopped writing at ${countOf(peer)}/${i}`);
    await sleep(1);
  }
  write(i);
}
for (let i = lockstep; i < lockstep + Number(burstArg); i++) write(i);
db.close();
