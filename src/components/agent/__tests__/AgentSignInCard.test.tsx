import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AgentSignInCard, AgentSignedInBanner, type AgentBlockedReadiness } from "@/components/agent/AgentSignInCard";
import { AgentChooserCard } from "@/components/agent/AgentChooserCard";
import { HARNESS_BILLING_COPY, HARNESS_INSTALL, type AgentReadiness } from "@/lib/agent/client/readiness";
import type { AgentHarnessId, AgentHarnessStatus } from "@/lib/agent/types";

/** What `claude auth login` prints for "If the browser didn't open": its manual flow, finished by pasting a code. */
const CLAUDE_MANUAL_URL =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&state=s";

function status(overrides: Partial<AgentHarnessStatus> = {}): AgentHarnessStatus {
  return {
    id: "claude",
    label: "Claude Code",
    installed: true,
    signedIn: false,
    billing: "none",
    models: [],
    signIn: { state: "idle" },
    signInCommand: "claude auth login",
    ...overrides,
  };
}

function renderCard(readiness: AgentBlockedReadiness, extra: Partial<Parameters<typeof AgentSignInCard>[0]> = {}) {
  const onSignIn = vi.fn();
  const onCheckAgain = vi.fn();
  const onCancelSignIn = vi.fn();
  const utils = render(
    <AgentSignInCard
      harness="claude"
      readiness={readiness}
      onSignIn={onSignIn}
      onCheckAgain={onCheckAgain}
      onCancelSignIn={onCancelSignIn}
      {...extra}
    />,
  );
  return { ...utils, onSignIn, onCheckAgain, onCancelSignIn };
}

afterEach(() => vi.useRealTimers());

describe("AgentSignInCard", () => {
  it("shows the first check as a skeleton, and says so after a few seconds", () => {
    vi.useFakeTimers();
    renderCard({ kind: "loading" });
    expect(screen.getByRole("status", { name: "Checking Claude Code" })).toBeInTheDocument();
    expect(screen.getByText("Still checking…")).toHaveAttribute("aria-hidden", "true");
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText("Still checking…")).not.toHaveAttribute("aria-hidden", "true");
  });

  it("names the neutral eyebrow before a harness is chosen", () => {
    renderCard({ kind: "loading" }, { eyebrow: "Agent" });
    expect(screen.getByRole("status", { name: "Checking Agent" })).toBeInTheDocument();
  });

  it("explains a failed status check in plain words, with the raw error behind Details", () => {
    const { onCheckAgain } = renderCard({ kind: "unavailable", message: "GET /api/agent/status → 500" });
    expect(screen.getByRole("heading", { name: "Couldn't reach Claude Code" })).toBeInTheDocument();
    expect(screen.getByText(/Node Banana's own server failed/)).toBeInTheDocument();
    expect(screen.getByText("GET /api/agent/status → 500")).toBeInTheDocument();
    expect(screen.getByText(/restart Node Banana/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  it("offers the install command and guide when the CLI is missing", () => {
    const { onCheckAgain } = renderCard({ kind: "not_installed", status: status({ installed: false }) });
    expect(screen.getByRole("heading", { name: "Install Claude Code to use the agent" })).toBeInTheDocument();
    expect(screen.getByText(HARNESS_INSTALL.claude.command)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /installation guide/i })).toHaveAttribute("href", HARNESS_INSTALL.claude.guideUrl);
    expect(screen.queryByRole("button", { name: /sign-in/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  it("signs out with one lead, one button, and the terminal folded away", () => {
    const { onSignIn, onCheckAgain } = renderCard({ kind: "signed_out", status: status() });
    expect(screen.getByRole("heading", { name: "Sign in to Claude Code" })).toBeInTheDocument();
    expect(screen.getByText(HARNESS_BILLING_COPY.claude.runsOn)).toBeInTheDocument();
    expect(screen.getByText(/Claude Code signs you in itself/)).toBeInTheDocument();
    expect(screen.queryByText("claude auth login")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Other ways to sign in" }));
    expect(screen.getByText("claude auth login")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy command" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Claude Code sign-in" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  it("uses Codex wording and its own command", () => {
    renderCard({ kind: "signed_out", status: status({ id: "codex", signInCommand: "codex login" }) }, { harness: "codex" });
    expect(screen.getByRole("heading", { name: "Sign in to Codex" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with ChatGPT" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Other ways to sign in" }));
    expect(screen.getByText("codex login")).toBeInTheDocument();
  });

  it("disables sign-in while the request is starting", () => {
    renderCard({ kind: "signed_out", status: status() }, { startingSignIn: true });
    expect(screen.getByRole("button", { name: /starting sign-in/i })).toBeDisabled();
  });

  it("walks a Claude sign-in: steps, elapsed time, when it gives up, and Cancel", () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const { onCancelSignIn, onCheckAgain } = renderCard({ kind: "signing_in", status: status(), url: CLAUDE_MANUAL_URL }, { signInStartedAt: startedAt });
    expect(screen.getByRole("heading", { name: "Finish in your browser" })).toBeInTheDocument();
    expect(screen.getByText("Claude Code opened its sign-in page. This window updates on its own.")).toBeInTheDocument();
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual(["✓Sign-in page opened", "2Approve Claude Code in the browser", "3Come back here"]);
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Approve Claude Code in the browser");
    // The manual URL the CLI prints is never linked.
    expect(screen.queryByRole("link", { name: /open the sign-in page/i })).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(42_000));
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for Claude Code · 0:42");
    expect(screen.getByRole("status")).toHaveTextContent("gives up in 9:18");

    fireEvent.click(screen.getByRole("button", { name: "Cancel sign-in" }));
    expect(onCancelSignIn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /check now/i }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  it("opens the ways out after a minute without a tab", () => {
    vi.useFakeTimers();
    const { onSignIn } = renderCard({ kind: "signing_in", status: status(), url: CLAUDE_MANUAL_URL }, { signInStartedAt: Date.now() });
    expect(screen.getByRole("button", { name: "No tab opened?" })).toHaveAttribute("aria-expanded", "false");
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole("button", { name: "No tab opened?" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: /open again/i }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /use the terminal/i }));
    expect(screen.getByText("claude auth login")).toBeInTheDocument();
  });

  it("shows a pending Codex sign-in with the device code and a real button to the page", () => {
    renderCard(
      {
        kind: "signing_in",
        status: status({ id: "codex", signInCommand: "codex login" }),
        url: "https://auth.openai.com/codex/device",
        userCode: "WXYZ-1234",
      },
      { harness: "codex" },
    );
    expect(screen.getByText("WXYZ-1234")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /open the sign-in page/i });
    expect(link).toHaveAttribute("href", "https://auth.openai.com/codex/device");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Open the sign-in page");
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for Codex");
    // Codex's help is open from the start: the panel shows the link itself.
    expect(screen.getByRole("button", { name: "Having trouble?" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: /open again/i })).not.toBeInTheDocument();
  });

  it("never renders a non-http sign-in link", () => {
    renderCard({ kind: "signing_in", status: status({ id: "codex" }), url: "javascript:alert(1)" }, { harness: "codex" });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps saying why while a sign-in replaces a login that can't run", () => {
    renderCard({
      kind: "signing_in",
      status: status({ signedIn: true, billing: "api", problem: "Claude Code is signed in with a Console API key." }),
    });
    expect(screen.getByText("Claude Code is signed in with a Console API key.")).toBeInTheDocument();
  });

  it("shows a failed sign-in with the CLI's reason, a retry, and the terminal open", () => {
    const { onSignIn } = renderCard({ kind: "sign_in_failed", status: status(), message: "Login failed: callback port in use" });
    expect(screen.getByRole("heading", { name: "Sign-in didn't finish" })).toBeInTheDocument();
    expect(screen.getByText("Login failed: callback port in use")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in from a terminal instead" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("claude auth login")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("refuses an API-billed login, shows what was found, and offers the switch", () => {
    const { onSignIn } = renderCard({
      kind: "wrong_billing",
      status: status({ signedIn: true, billing: "api", problem: "Claude Code is signed in with a Console API key." }),
    });
    expect(screen.getByRole("heading", { name: "This login would bill API credits" })).toBeInTheDocument();
    expect(screen.getByText(/only runs the agent on a paid Claude subscription/)).toBeInTheDocument();
    expect(screen.getByText("Bills API credits")).toBeInTheDocument();
    expect(screen.getByText("Claude Code is signed in with a Console API key.")).toBeInTheDocument();
    expect(screen.getByText(/The current login stays in Claude Code until you switch/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch to your Claude account" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("describes an unconfirmed subscription without API-credit wording", () => {
    renderCard({ kind: "unconfirmed_billing", status: status({ signedIn: true, billing: "unknown" }) });
    expect(screen.getByRole("heading", { name: "No paid Claude subscription on this login" })).toBeInTheDocument();
    expect(screen.queryByText(/API credits/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to your Claude account" })).toBeInTheDocument();
  });

  it("shows why a replacement sign-in didn't finish on the billing card", () => {
    renderCard({ kind: "wrong_billing", status: status({ signedIn: true, billing: "api" }), signInError: "Login timed out" });
    expect(screen.getByText(/Sign-in didn't finish: Login timed out/)).toBeInTheDocument();
  });

  it("never labels a button as a Claude login offered by the app", () => {
    const blocked: AgentBlockedReadiness[] = [
      { kind: "signed_out", status: status() },
      { kind: "sign_in_failed", status: status(), message: "Login timed out" },
      { kind: "wrong_billing", status: status({ signedIn: true, billing: "api" }) },
      { kind: "unconfirmed_billing", status: status({ signedIn: true, billing: "unknown" }) },
      { kind: "signing_in", status: status(), url: CLAUDE_MANUAL_URL },
      { kind: "not_installed", status: status({ installed: false }) },
    ];
    for (const readiness of blocked) {
      const { unmount } = renderCard(readiness);
      for (const button of screen.queryAllByRole("button")) {
        expect(button, readiness.kind).not.toHaveAccessibleName(/sign in with claude/i);
      }
      unmount();
    }
    renderCard({ kind: "signed_out", status: status() });
    expect(screen.getByRole("button", { name: /Claude Code sign-in/ })).toHaveAccessibleName("Open Claude Code sign-in");
  });

  it("falls back to the default command before the status has one", () => {
    renderCard({ kind: "signed_out", status: status({ signInCommand: "" }) });
    fireEvent.click(screen.getByRole("button", { name: "Other ways to sign in" }));
    expect(screen.getByText("claude auth login")).toBeInTheDocument();
  });
});

describe("AgentSignedInBanner", () => {
  it("names who is in, on what, and can be dismissed", () => {
    const onDismiss = vi.fn();
    render(<AgentSignedInBanner harness="claude" email="me@example.com" plan="Max" model="Opus 5.5" onDismiss={onDismiss} />);
    expect(screen.getByRole("status")).toHaveTextContent("Signed in to Claude Code as me@example.com · Max · Opus 5.5");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("AgentChooserCard", () => {
  const readiness = (claude: AgentReadiness, codex: AgentReadiness): Record<AgentHarnessId, AgentReadiness> => ({ claude, codex });

  it("lists both harnesses with their state, the closest to working first, and one action each", () => {
    const onPick = vi.fn();
    render(
      <AgentChooserCard
        readiness={readiness(
          { kind: "not_installed", status: status({ installed: false }) },
          { kind: "signed_out", status: status({ id: "codex", label: "Codex", signInCommand: "codex login" }) },
        )}
        onPick={onPick}
        onCheckAgain={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: "Choose how to run the agent" })).toBeInTheDocument();
    const rows = screen.getAllByTestId(/agent-chooser-(claude|codex)/);
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual(["agent-chooser-codex", "agent-chooser-claude"]);
    expect(rows[0]).toHaveTextContent("Signed out");
    expect(rows[0]).toHaveTextContent("Uses your ChatGPT plan.");
    expect(rows[1]).toHaveTextContent("Not installed");

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onPick).toHaveBeenCalledWith("codex", "sign_in");
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(onPick).toHaveBeenCalledWith("claude", "show");
  });

  it("offers a wrong-account login as a switch, and says why", () => {
    const onPick = vi.fn();
    render(
      <AgentChooserCard
        readiness={readiness(
          { kind: "wrong_billing", status: status({ signedIn: true, billing: "api" }) },
          { kind: "signed_out", status: status({ id: "codex", label: "Codex", signInCommand: "codex login" }) },
        )}
        onPick={onPick}
        onCheckAgain={() => {}}
      />,
    );
    const claude = screen.getByTestId("agent-chooser-claude");
    expect(claude).toHaveTextContent("Wrong account");
    expect(claude).toHaveTextContent("bills API credits, not a subscription");
    fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
    expect(onPick).toHaveBeenCalledWith("claude", "show");
  });
});
