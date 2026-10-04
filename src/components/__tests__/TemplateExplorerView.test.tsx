import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TemplateExplorerView } from "@/components/quickstart/TemplateExplorerView";

const communityFile = {
  version: 1,
  id: "wf_author_123",
  directoryPath: "/Users/author/Projects/fox",
  name: "Community Fox",
  nodes: [],
  edges: [],
  edgeStyle: "angular",
};

describe("TemplateExplorerView community workflows", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/community-workflows") {
          return {
            json: async () => ({
              success: true,
              workflows: [
                { id: "cw-1", name: "Community Fox", filename: "fox.json", author: "someone", size: 1, description: "A fox", nodeCount: 2, tags: [] },
              ],
            }),
          };
        }
        if (url === "/api/community-workflows/cw-1") {
          return { json: async () => ({ success: true, downloadUrl: "https://r2.example/fox.json" }) };
        }
        if (url === "https://r2.example/fox.json") {
          return { ok: true, json: async () => ({ ...communityFile }) };
        }
        throw new Error(`unexpected fetch ${url}`);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens a community workflow without its author's id or folder", async () => {
    const onWorkflowSelected = vi.fn();
    render(<TemplateExplorerView onBack={vi.fn()} onWorkflowSelected={onWorkflowSelected} />);

    fireEvent.click(await screen.findByText("Community Fox"));

    await waitFor(() => expect(onWorkflowSelected).toHaveBeenCalledOnce());
    const opened = onWorkflowSelected.mock.calls[0][0];
    expect(opened).not.toHaveProperty("id");
    expect(opened).not.toHaveProperty("directoryPath");
    expect(opened).toMatchObject({ version: 1, name: "Community Fox", nodes: [], edges: [] });
  });
});
