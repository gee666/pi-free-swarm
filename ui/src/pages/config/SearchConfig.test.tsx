import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { installFakeApi } from "../../test/fakeApi";
import { SearchConfig } from "./SearchConfig";

afterEach(() => vi.restoreAllMocks());
it("shows read-only search settings", async () => {
  const api = installFakeApi();
  api.on("GET", "/api/swarms/3/search-config", () => ({
    ranking: "bm25",
    embedding: "off",
    reranker: "helper provider/model/high",
    maxResults: 20,
  }));
  render(<SearchConfig swarmId="3" />);
  expect(await screen.findByText("Ranking: BM25")).toBeInTheDocument();
  expect(screen.getByText("Embeddings: off")).toBeInTheDocument();
  expect(screen.getByText("Reranker: helper provider/model/high")).toBeInTheDocument();
  expect(screen.getByText("Max results per page: 20")).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
