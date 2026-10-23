import type { BudgetStatus } from "./budget.js";
import type { SavedRunConfiguration } from "./run-configuration.js";

export type ConfigurationChange =
  | { type: "addAgents"; count: number }
  | { type: "removeAgent"; name: string }
  | { type: "raiseBudget"; moneyUsd?: number; timeSeconds?: number }
  | { type: "retireAgent"; name: string; handoffFile: string };

export interface ConfigurationRequest {
  id: number;
  swarmId: number;
  run: number;
  expectedRevision: number;
  change: ConfigurationChange;
  requestedBy: string;
  status: "pending" | "applying" | "applied" | "rejected";
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface RuntimeConfigurationView {
  swarmId: number;
  run: number;
  revision: number;
  configuration: SavedRunConfiguration | null;
  budget: BudgetStatus | null;
  requests: ConfigurationRequest[];
  /** Requests are a bounded newest-first recent slice, not the complete audit history. */
  requestTotal?: number;
}
