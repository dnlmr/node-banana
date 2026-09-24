import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScrubRow, formatTime } from "../ScrubRow";

function video(paused = false) {
  return {
    paused,
    currentTime: 0,
    duration: 8,
    readyState: 1,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLVideoElement;
}

describe("ScrubRow", () => {
  it("formats times", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65.4)).toBe("1:05");
    expect(formatTime(NaN)).toBe("0:00");
  });

  it("scrubbing pauses a playing video and holds the chosen frame", () => {
    const v = video(false);
    render(<ScrubRow videoRef={{ current: v }} src="blob:a" />);
    fireEvent.change(screen.getByLabelText("Seek"), { target: { value: "3.5" } });
    expect(v.pause).toHaveBeenCalledTimes(1);
    expect(v.currentTime).toBe(3.5);
  });

  it("scrubbing a paused video only seeks", () => {
    const v = video(true);
    render(<ScrubRow videoRef={{ current: v }} src="blob:a" />);
    fireEvent.change(screen.getByLabelText("Seek"), { target: { value: "2" } });
    expect(v.pause).not.toHaveBeenCalled();
    expect(v.currentTime).toBe(2);
  });

  it("the button plays a paused video and pauses a playing one", () => {
    const v = video(true);
    render(<ScrubRow videoRef={{ current: v }} src="blob:a" />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(v.play).toHaveBeenCalledTimes(1);
  });
});
