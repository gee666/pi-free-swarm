import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { FakeExtensionApi } from "../helpers/fake-extension-api.js";

const runtimeImports: string[] = [];
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (/\/(?:main-runtime|agent-mode|server\/host|tools\/main-tools)\.[jt]s$/.test(result.url)) {
      runtimeImports.push(result.url);
    }
    return result;
  },
});
try {
  const { default: factory } = await import("../../index.js");
  const pi = new FakeExtensionApi();
  await factory(pi);
  await pi.startSession();
  assert.equal(pi.getFlag("swarm"), false);
  assert.equal(pi.commands.size, 5);
  assert.deepEqual(pi.toolNames(), []);
  assert.deepEqual(runtimeImports, [], "inactive sessions must not import the swarm runtime graph");
  await pi.shutdownSession();
  console.log("INACTIVE_IMPORTS_OK");
} finally {
  hooks.deregister();
}
