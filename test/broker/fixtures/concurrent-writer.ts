// Child process for the multi-process test: argv = dbPath swarmId author writes startAt.
// Waits until `startAt` so both writers really overlap, then alternates posts and messages.
import { sendMessage } from "../../../src/broker/messages.js";
import { createPost } from "../../../src/broker/wall.js";
import { openSwarmDb } from "../../../src/store/db.js";

const [dbPath, swarmId, author, writes, startAt] = process.argv.slice(2);
const db = openSwarmDb(dbPath, { create: false });
const wait = Number(startAt) - Date.now();
if (wait > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
for (let i = 0; i < Number(writes); i++) {
  if (i % 2 === 0) createPost(db, Number(swarmId), author, { title: `${author} ${i}`, text: "concurrent" }, Date.now());
  else sendMessage(db, Number(swarmId), author, ["User", "Liam"], `${author} ${i}`, Date.now());
}
db.close();
