// Exercises pi's actual detached-child tracker and TERM cleanup, without provider/auth startup.
import { spawn } from "node:child_process";
import {
  killTrackedDetachedChildren,
  trackDetachedChildPid,
} from "../../node_modules/@earendil-works/pi-coding-agent/dist/utils/shell.js";

const bash = spawn("bash", ["-c", "exec sleep 300"], { detached: true, stdio: "ignore" });
if (bash.pid === undefined) throw new Error("Missing bash pid");
trackDetachedChildPid(bash.pid);
process.on("SIGTERM", () => {
  killTrackedDetachedChildren();
  bash.once("exit", () => process.exit(143));
});
console.log(bash.pid);
