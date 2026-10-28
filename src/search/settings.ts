import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { SettingsError } from "../settings-error.js";

export interface SearchEndpoint {
  url: string;
  model: string;
  apiKeyEnv?: string;
}

export const SEARCH_JEV_MODEL = "jev-latest";
export const SEARCH_JEV_TIMEOUT_MS = 120_000;

export interface JevSettings {
  url: string;
  apiKeyEnv: string;
  model?: string;
  timeoutMs?: number;
}

export interface SearchSettings {
  maxResults?: number;
  timeoutMs?: number;
  embedding?: SearchEndpoint;
  jev?: JevSettings;
}

export interface SearchConfiguration {
  env?: Record<string, string>;
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
  if (value.reranker !== undefined) throw new SettingsError("search.reranker is no longer supported; use search.jev");
  const search: SearchSettings = {
    maxResults: positiveInteger(value.maxResults, "search.maxResults"),
    timeoutMs: positiveInteger(value.timeoutMs, "search.timeoutMs"),
    embedding: endpoint(value.embedding, "search.embedding"),
    jev: jevEndpoint(value.jev),
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
  const { model } = value;
  const connection = endpointConnection(value, key);
  if (typeof model !== "string" || !model.trim()) throw new SettingsError(`${key}.model must be nonempty`);
  return { ...connection, model };
}

function jevEndpoint(value: unknown): JevSettings | undefined {
  if (value === undefined) return undefined;
  const key = "search.jev";
  if (!isRecord(value)) throw new SettingsError(`${key} must be an object`);
  const { url, apiKeyEnv } = endpointConnection(value, key);
  if (apiKeyEnv === undefined) throw new SettingsError(`${key}.apiKeyEnv is required`);
  const { model } = value;
  if (model !== undefined && (typeof model !== "string" || !model.trim())) {
    throw new SettingsError(`${key}.model must be nonempty`);
  }
  return {
    url,
    apiKeyEnv,
    ...(typeof model === "string" ? { model } : {}),
    ...(value.timeoutMs === undefined ? {} : { timeoutMs: positiveInteger(value.timeoutMs, `${key}.timeoutMs`) }),
  };
}

function endpointConnection(value: Record<string, unknown>, key: string): Pick<SearchEndpoint, "url" | "apiKeyEnv"> {
  const { url, apiKeyEnv } = value;
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
  if (apiKeyEnv !== undefined && (typeof apiKeyEnv !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv))) {
    throw new SettingsError(`${key}.apiKeyEnv must be an environment variable name`);
  }
  return { url, ...(typeof apiKeyEnv === "string" ? { apiKeyEnv } : {}) };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
