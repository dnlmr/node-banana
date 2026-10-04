import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunBatchChip } from "../RunBatchChip";

describe("RunBatchChip", () => {
  it("says which run of the batch the output came from", () => {
    render(<RunBatchChip batch={{ id: "b", index: 7, count: 10 }} />);
    expect(screen.getByText("Run 7 of 10")).toBeInTheDocument();
  });

  it("adds the time of the run", () => {
    const at = new Date(2026, 9, 2, 14, 2).getTime();
    render(<RunBatchChip batch={{ id: "b", index: 1, count: 2 }} timestamp={at} />);
    expect(screen.getByText(/^Run 1 of 2 · /)).toHaveTextContent(new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  });

  it("shows nothing for an output of a single run", () => {
    const { container } = render(<RunBatchChip />);
    expect(container).toBeEmptyDOMElement();
  });
});
