import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { SettingsError } from "../settings-error.js";

export interface SearchEndpoint {
  url: string;
  model: string;
  apiKeyEnv?: string;
}

export interface SearchSettings {
  maxResults?: number;
  timeoutMs?: number;
  embedding?: SearchEndpoint;
  reranker?: SearchEndpoint;
}

export interface SearchConfiguration {
  search?: SearchSettings;
  helperModel?: string;
}

export function parseHelperModel(value: unknown): {
  provider: string;
  model: string;
  reasoning: ThinkingLevel | undefined;
} {
  if (typeof value !== "string") throw new SettingsError("helperModel must be provider/model/thinking");
  const parts = value.split("/");
  const provider = parts.shift();
  const thinking = parts.pop();
  const model = parts.join("/");
  if (!provider?.trim() || !model.trim()) throw new SettingsError("helperModel must be provider/model/thinking");
  switch (thinking) {
    case "off":
      return { provider, model, reasoning: undefined };
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return { provider, model, reasoning: thinking };
    default:
      throw new SettingsError("helperModel thinking must be off, minimal, low, medium, high, xhigh or max");
  }
}

export function parseSearchConfiguration(source: Record<string, unknown>): SearchConfiguration {
  const helperModel = source.helperModel;
  if (helperModel !== undefined) parseHelperModel(helperModel);
  const value = source.search;
  if (value === undefined) return typeof helperModel === "string" ? { helperModel } : {};
  if (!isRecord(value)) throw new SettingsError("search must be an object");
  const search: SearchSettings = {
    maxResults: positiveInteger(value.maxResults, "search.maxResults"),
    timeoutMs: positiveInteger(value.timeoutMs, "search.timeoutMs"),
    embedding: endpoint(value.embedding, "search.embedding"),
    reranker: endpoint(value.reranker, "search.reranker"),
  };
  return { search, ...(typeof helperModel === "string" ? { helperModel } : {}) };
}

function positiveInteger(value: unknown, key: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  throw new SettingsError(`${key} must be a positive safe integer`);
}

function endpoint(value: unknown, key: string): SearchEndpoint | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new SettingsError(`${key} must be an object`);
  const { url, model, apiKeyEnv } = value;
  if (typeof url !== "string") throw new SettingsError(`${key}.url must be an http(s) URL`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SettingsError(`${key}.url must be an http(s) URL`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search
  ) {
    throw new SettingsError(`${key}.url must be an http(s) URL without credentials, query or fragment`);
  }
  if (typeof model !== "string" || !model.trim()) throw new SettingsError(`${key}.model must be nonempty`);
  if (apiKeyEnv !== undefined && (typeof apiKeyEnv !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv))) {
    throw new SettingsError(`${key}.apiKeyEnv must be an environment variable name`);
  }
  return { url, model, ...(typeof apiKeyEnv === "string" ? { apiKeyEnv } : {}) };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
