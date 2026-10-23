import type { ConfigurationChange, RuntimeConfigurationView } from "../../../src/runtime-configuration";
import { getJson, postJson } from "./http";

const configurationUrl = (swarmId: string) => `/api/swarms/${encodeURIComponent(swarmId)}/config`;

export function fetchConfiguration(swarmId: string, signal: AbortSignal): Promise<RuntimeConfigurationView> {
  return getJson<RuntimeConfigurationView>(configurationUrl(swarmId), signal);
}

export function requestConfigurationChange(
  swarmId: string,
  expectedRun: number,
  expectedRevision: number,
  change: ConfigurationChange,
): Promise<RuntimeConfigurationView> {
  return postJson<RuntimeConfigurationView>(configurationUrl(swarmId), { expectedRun, expectedRevision, change });
}
