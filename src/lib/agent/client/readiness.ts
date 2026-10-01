/**
 * What the agent panel should show for one harness, derived from the status
 * route and any sign-in the panel started. Pure so every state is testable.
 */

import type { AgentHarnessId, AgentHarnessStatus, AgentSignInStart } from "../types";

export type AgentReadiness =
  /** First status check still running. */
  | { kind: "loading" }
  /** The status route itself failed. */
  | { kind: "unavailable"; message: string }
  | { kind: "not_installed"; status: AgentHarnessStatus }
  | { kind: "signed_out"; status: AgentHarnessStatus }
  /** A vendor sign-in is running: a first login, or one replacing a login that can't run. */
  | { kind: "signing_in"; status: AgentHarnessStatus; url?: string; userCode?: string }
  | { kind: "sign_in_failed"; status: AgentHarnessStatus; message: string }
  /**
   * Signed in, but the credential would bill an API account. `signInError`:
   * the sign-in started to replace it didn't finish.
   */
  | { kind: "wrong_billing"; status: AgentHarnessStatus; signInError?: string }
  /**
   * Signed in, but no subscription could be confirmed on the login (a Claude
   * account without a Pro or Max plan, an unrecognised login type). Not an
   * API login, so the card must not say it would bill API credits.
   */
  | { kind: "unconfirmed_billing"; status: AgentHarnessStatus; signInError?: string }
  | { kind: "ready"; status: AgentHarnessStatus };

export type AgentReadinessKind = AgentReadiness["kind"];

/** A sign-in the panel started, stamped with when its POST returned. */
export type AgentSignInAttempt = AgentSignInStart & { startedAt: number };

export interface DeriveReadinessInput {
  status?: AgentHarnessStatus;
  /** When the request that produced `status` was sent (ms epoch). */
  statusCheckedAt?: number;
  /** The panel's latest sign-in request for this harness, if any. */
  signIn?: AgentSignInAttempt | null;
  /** Error from the status route, if the last check failed. */
  fetchError?: string | null;
}

export function isHarnessReady(status: AgentHarnessStatus | undefined): boolean {
  return !!status && status.installed && status.signedIn && status.billing === "subscription";
}

export function deriveAgentReadiness({
  status,
  statusCheckedAt,
  signIn,
  fetchError,
}: DeriveReadinessInput): AgentReadiness {
  if (!status) {
    return fetchError ? { kind: "unavailable", message: fetchError } : { kind: "loading" };
  }
  if (!status.installed) return { kind: "not_installed", status };
  if (isHarnessReady(status)) return { kind: "ready", status };

  // The panel's own attempt only speaks for the gap between its POST returning
  // and the next status check: after that, the server's account of the flow wins
  // (a flow that timed out must not read as "waiting" forever).
  const attemptIsNewer = !!signIn && (statusCheckedAt === undefined || statusCheckedAt < signIn.startedAt);

  // A running sign-in comes first, also over a login that can't run: that
  // sign-in is how the user replaces it, and it may need a device code or link.
  if (status.signIn.state === "pending") {
    return {
      kind: "signing_in",
      status,
      url: status.signIn.url ?? signIn?.url,
      userCode: status.signIn.userCode ?? signIn?.userCode,
    };
  }
  if (attemptIsNewer && signIn.state === "pending") {
    return { kind: "signing_in", status, url: signIn.url, userCode: signIn.userCode };
  }

  if (status.signedIn) {
    // The server keeps a failed attempt until the next one starts, so its error
    // rides along on the billing card rather than replacing it.
    const signInError =
      (attemptIsNewer && signIn.state === "failed" ? signIn.message : undefined) ??
      (status.signIn.state === "failed" ? status.signIn.error : undefined);
    const kind = status.billing === "api" ? "wrong_billing" : "unconfirmed_billing";
    return signInError ? { kind, status, signInError } : { kind, status };
  }

  if (status.signIn.state === "failed") {
    return {
      kind: "sign_in_failed",
      status,
      message: status.signIn.error || "Sign-in didn't finish. Try again, or run the command below in a terminal.",
    };
  }
  if (attemptIsNewer && signIn.state === "failed") {
    return {
      kind: "sign_in_failed",
      status,
      message: signIn.message || "Sign-in couldn't start. Run the command below in a terminal instead.",
    };
  }
  return { kind: "signed_out", status };
}

/** Whether the panel should poll the status route for this harness. */
export function shouldPollReadiness(readiness: AgentReadiness): boolean {
  return readiness.kind === "signing_in";
}

export type AgentStatusTone = "ready" | "attention" | "blocked" | "unknown";

/** The colour of the harness dot in the panel header. */
export function readinessTone(readiness: AgentReadiness): AgentStatusTone {
  switch (readiness.kind) {
    case "ready":
      return "ready";
    case "signed_out":
    case "signing_in":
    case "sign_in_failed":
      return "attention";
    case "not_installed":
    case "wrong_billing":
    case "unconfirmed_billing":
      return "blocked";
    default:
      return "unknown";
  }
}

export const HARNESS_LABELS: Record<AgentHarnessId, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** Each harness's brand colour: Claude's clay, and the app's blue for Codex. */
export const HARNESS_COLORS: Record<AgentHarnessId, string> = {
  claude: "#D97757",
  codex: "#3b82f6",
};

/**
 * What each harness runs on, in the words the panel uses. The app guarantees
 * only what it enforces: never an API key. The vendor may still bill usage past
 * the plan (Claude extra usage, Codex credits), so the copy says so rather than
 * promising the agent costs nothing beyond the plan.
 */
export const HARNESS_BILLING_COPY: Record<
  AgentHarnessId,
  {
    /** "paid Claude subscription", "ChatGPT plan": the thing the agent runs on. */
    plan: string;
    /** The account, as the switch button names it: "Claude", "ChatGPT". */
    account: string;
    /** The sign-in card's one-line lead. */
    runsOn: string;
    /** The line under a fresh chat. */
    footer: string;
    /** Under the sign-in button: whose sign-in it opens. */
    signInNote: string;
  }
> = {
  claude: {
    plan: "paid Claude subscription",
    account: "Claude",
    runsOn: "Uses your paid Claude subscription.",
    footer: "Runs on your paid Claude subscription's usage limits through Claude Code. Stops at the limit instead of using extra usage.",
    signInNote: "Claude Code signs you in itself, in your browser. Node Banana never sees your password or tokens.",
  },
  codex: {
    plan: "ChatGPT plan",
    account: "ChatGPT",
    runsOn: "Uses your ChatGPT plan.",
    footer: "Runs on your ChatGPT plan's Codex limits through Codex. Stops at the limit instead of spending credits.",
    signInNote: "Codex signs you in with OpenAI, in your browser. Node Banana never sees your password or tokens.",
  },
};

/** How to get each CLI onto this computer, for the not-installed card. */
export const HARNESS_INSTALL: Record<AgentHarnessId, { command: string; guideUrl: string }> = {
  claude: { command: "npm install -g @anthropic-ai/claude-code", guideUrl: "https://docs.claude.com/en/docs/claude-code/setup" },
  codex: { command: "npm install -g @openai/codex", guideUrl: "https://developers.openai.com/codex/cli" },
};

/** How long the vendor CLIs are given to finish a sign-in before the server gives up on the flow. */
export const AGENT_SIGN_IN_TIMEOUT_MS = 10 * 60_000;

/**
 * What the panel opens on the first time, given every harness's readiness:
 * a harness with a paid subscription wins (the preferred one when both have
 * one); with none, the chooser. `checking` while any is still unknown.
 */
export type FirstOpenDecision = { kind: "checking" } | { kind: "open"; harness: AgentHarnessId } | { kind: "choose" };

export function decideFirstOpen(readiness: Record<AgentHarnessId, AgentReadiness>, preferred: AgentHarnessId): FirstOpenDecision {
  const ids = Object.keys(readiness) as AgentHarnessId[];
  if (ids.some((id) => readiness[id].kind === "loading")) return { kind: "checking" };
  if (readiness[preferred]?.kind === "ready") return { kind: "open", harness: preferred };
  const ready = ids.find((id) => readiness[id].kind === "ready");
  return ready ? { kind: "open", harness: ready } : { kind: "choose" };
}

/** The chooser lists the closest-to-working harness first. */
const CHOOSER_RANK: Record<AgentReadinessKind, number> = {
  ready: 0,
  signed_out: 1,
  sign_in_failed: 1,
  signing_in: 1,
  wrong_billing: 2,
  unconfirmed_billing: 2,
  not_installed: 3,
  unavailable: 4,
  loading: 5,
};

export function chooserOrder(readiness: Record<AgentHarnessId, AgentReadiness>): AgentHarnessId[] {
  return (Object.keys(readiness) as AgentHarnessId[]).sort(
    (a, b) => CHOOSER_RANK[readiness[a].kind] - CHOOSER_RANK[readiness[b].kind]
  );
}

/**
 * Whether the vendor CLI opens its sign-in page itself. Claude Code does, and
 * the panel never shows the URL it prints: that one is the manual flow, which
 * ends in a code pasted back into the CLI, and relaying it would put the app
 * between the user and their credential. Its fallback is the terminal command.
 * Codex's app-server hands the URL to the client, so the panel opens it.
 */
export const HARNESS_CLI_OPENS_BROWSER: Record<AgentHarnessId, boolean> = {
  claude: true,
  codex: false,
};

/** Fallback terminal commands, used until the status route has answered. */
export const HARNESS_SIGN_IN_COMMANDS: Record<AgentHarnessId, string> = {
  claude: "claude auth login",
  codex: "codex login",
};
