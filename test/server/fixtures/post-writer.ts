// Child process for the SSE test: argv = dbPath swarmId author title. Writes one post through its own DB handle.
import { createPost } from "../../../src/broker/wall.js";
import { openSwarmDb } from "../../../src/store/db.js";

const [dbPath, swarmArg, author, title] = process.argv.slice(2);
const db = openSwarmDb(dbPath, { create: false });
createPost(db, Number(swarmArg), author, { title, text: "from another process" }, Date.now());
db.close();
