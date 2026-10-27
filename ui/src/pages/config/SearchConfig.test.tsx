import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { installFakeApi } from "../../test/fakeApi";
import { SearchConfig } from "./SearchConfig";

afterEach(() => vi.restoreAllMocks());
it.each(["JEV jev-latest", "helper model provider/model/high", "off"])(
  "shows read-only search settings with %s",
  async (reranker) => {
    const api = installFakeApi();
    api.on("GET", "/api/swarms/3/search-config", () => ({
      ranking: "bm25",
      embedding: "off",
      reranker,
      maxResults: 20,
    }));
    render(<SearchConfig swarmId="3" />);
    expect(await screen.findByText("Ranking: BM25")).toBeInTheDocument();
    expect(screen.getByText("Embeddings: off")).toBeInTheDocument();
    expect(screen.getByText(`Reranker: ${reranker}`)).toBeInTheDocument();
    expect(screen.getByText("Max results per page: 20")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  },
);
