import React, { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { OpenAIImageSizeField } from "../OpenAIImageSizeField";
import { pickOption } from "@/test/dropdown";

afterEach(cleanup);
function Harness({ initial = "auto" }) {
  const [size, setSize] = useState(initial);
  return <><OpenAIImageSizeField value={size} onChange={setSize} /><output>{size}</output></>;
}

describe("OpenAI output dimensions", () => {
  it("edits custom dimensions and returns to presets", () => {
    render(<Harness />);
    pickOption(screen.getByLabelText("Size"), "custom");
    fireEvent.focus(screen.getByLabelText("Width"));
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "1600" } });
    fireEvent.blur(screen.getByLabelText("Width"));
    expect(screen.getByRole("status").textContent).toBe("1600x864");
    pickOption(screen.getByLabelText("Size"), "1024x1024");
    expect(screen.queryByLabelText("Width")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("1024x1024");
  });
  it("restores saved custom sizes and shows validation", () => {
    render(<Harness initial="1601x864" />);
    expect(screen.getByLabelText("Width")).toHaveValue(1601);
    expect(screen.getByRole("alert")).toHaveTextContent("multiples of 16");
  });
});
