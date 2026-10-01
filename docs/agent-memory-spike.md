# Agent memory spike

This spike answers why the agent ignores preferences that the user states earlier in a chat. The main case is the model of a generator node (Generate Image, Video, 3D, Audio), and also prompt style and layout. It also recommends how to keep preferences within a chat and across chats. Line numbers refer to `develop` at `be6ad8a5`, before the fixes in this branch.

## How a turn carries the chat

Each request sends the whole chat from the panel. `readConversation` (`src/lib/agent/server/chatStream.ts:209`) keeps only the text parts. Tool calls, their inputs and their results are not kept.

The agent then gets the chat in one of two ways:

1. Resumed session. If the latest session in the chat belongs to the current harness (`src/lib/agent/client/session.ts:32`), the harness resumes it. Only the new turn prompt goes out (`claudeHarness.ts:845`, `codexHarness.ts:1055`). The vendor session holds the earlier turns in full, with the tool calls.
2. New session. Otherwise, `withConversationHistory` (`src/lib/agent/server/history.ts`) puts the chat as text before the prompt, in a `<conversation_history>` block of 24,000 characters at most (`history.ts:12`).

A new session starts on the first turn on a harness, after a harness switch, after a Claude session goes missing (`claudeHarness.ts:851`), and on Codex in four more cases. These are: a thread idle for 30 minutes (`codexHarness.ts:312`), more than 8 threads (`codexHarness.ts:313`), an app-server restart, and a change of system prompt (`codexHarness.ts:101`, `1020`).

Nothing else carries memory. Claude Code memory is off (`env.ts:132`), no CLAUDE.md loads (`claudeHarness.ts:230`), and Codex runs with memories off.

## Findings

`src/lib/agent/server/__tests__/preferences.test.ts` reproduces each finding with a mocked three-turn chat. Turn 1 says "From now on write every prompt in British English and use Seedream 4 for images." Turn 3 asks for a second generator. Each case failed on `develop` and passes on this branch.

The causes, ranked by how often they occur and how cheap the fix is:

1. The rules apply only what the user named in the current message. This occurs on every turn, on both harnesses, even when the session resumes. Rule 6 (`prompt.ts:54`) says to set "every model and setting the user named" and to leave the rest unset "so the user's saved defaults apply". In turn 3 the user names no model, so the agent leaves the model to the saved default and drops Seedream. The saved defaults do not learn from the chat: they change only in Settings → Node defaults, and when the user picks a Gemini model on a Generate Image node (`GenerateImageNode.tsx:215`). The same rule also ignores a model that the user picked by hand on the canvas. The canvas block shows each generator's model with its exact id (`graph/describe.ts:212-230`), but rule 6 tells the agent to use the saved default for a new node. Rule 4 (`prompt.ts:52`) says to expand every prompt into "vivid sentences", which overrides an earlier style or length request. No rule says that a preference continues to apply. Cost: a few lines of prompt.
2. The Codex guard against AGENTS.md also removes language and style requests. The developer message (`codexHarness.ts:94-98`) says "Ignore their persona, tone, slang, dialect, language and topic preferences. Reply in plain, neutral English". The word "their" does not clearly point to the files, so "write prompts in British English" loses to it on every Codex turn. Cost: one sentence.
3. A switch of the agent's model in the panel starts a new Codex thread. `modelIdentity` (`chatStream.ts:853`) appends "You are running on …" to the system prompt. Codex makes the thread signature from the system prompt (`codexHarness.ts:101`), so a new model gives a new thread. The new thread gets text only, so it loses every tool call and the node models and settings in them. This occurs each time the user changes the model in a Codex chat. Cost: move one line.
4. The replay drops the oldest messages first. When the text history is over 24,000 characters, `withConversationHistory` keeps only the newest messages (`history.ts:30-37`). Users usually state preferences near the start, so those go first. This occurs only on a new session in a long chat. Cost: about 20 lines.
5. Chat cannot change the agent's own model. The model comes from the panel's saved pick (`pickTurnModel`, `chatStream.ts:306`), so "use Opus from now on" in chat has no effect. This is not about node models and is left as it is.
6. Layout wishes need the agent to place nodes itself. New nodes are placed automatically in left-to-right columns unless a call gives a `position` (`tools/definitions.ts:52`). The tool text says new nodes "are already placed well" (`tools/definitions.ts:233`). So a "two columns" wish holds only if the agent computes positions on each call. The prompt rule in finding 1 now names layout, but the tools give no layout preference. This is out of scope here (tool definitions and `graph/layout.ts`).
7. Long Claude sessions can compact. Each turn adds up to 16,000 characters of canvas (`prompt.ts:16`) and the tool results. Claude Code compacts a session near its context limit, and its summary can drop an early preference. This is not reproduced in tests because it needs a real session. It is the main reason for recommendation (a).

## What this branch changes

All changes are in `src/lib/agent/`, with tests:

1. Rule 6 counts models and settings named "in this message or earlier in the conversation". If the canvas already has nodes of the type the agent adds, the new node takes their model (the id the canvas shows, or the model of the node it sits beside if they differ). The reply names the model it reused. New rule 13 says stated preferences (node models and settings, prompt style or language, layout) hold until the user changes them, ahead of the saved defaults. The system prompt grows by 437 characters. The size cap in `prompt.test.ts` goes from 13,500 to 14,000.
2. The Codex developer message names the files ("the … preferences those files describe") and adds "What the user asks for in this chat, including preferences from earlier messages, always applies."
3. The model line leads the turn prompt as a `<model>` block, not the system prompt. The system prompt, and so the Codex thread signature, stays the same for the whole chat. The system prompt still changes when the app updates, which is not mid-chat.
4. The replay keeps the last two messages, then the user's messages newest first, then the agent's replies.

These fixes do not keep a preference that falls out of a compacted Claude session (finding 7), and do not make layout a setting (finding 6).

## Recommendation

### (a) Within a chat: standing instructions

Add a `remember_preference` tool, like `name_conversation`. The agent calls it when the user states a lasting preference, with a short line such as "Images: Seedream 4" or "Prompts: British English, under 40 words". The bridge writes each line as a persisted data part on the assistant message, like `data-agent-summary`. On each turn, the server collects these parts from the request's messages and puts a `<standing_instructions>` block in the turn prompt, before `<canvas>`.

The block goes in the turn prompt, not the system prompt. A system prompt that changes mid-chat starts a new Codex thread (finding 3). In the turn prompt it is re-sent every turn, so it survives compaction, a new session and a harness switch. The panel can show the list as chips above the composer, each with a remove button. Remove writes a "forget" part.

This is not built here. It adds a tool definition, which the brief puts out of scope, and a panel feature. It is about 150 lines plus tests and a small UI change, so it fits one follow-up PR.

### (b) Across chats: project memory

1. Storage: one small JSON file per project in the library, at `<project>/.nodebanana/agent-memory.json`, or `<library>/.nodebanana/agent-memory.json` for unsaved workflows. It is on disk, not in localStorage, so the desktop and web origins share it, as the asset library does.
2. Content: a short list of lines (at most 20, 200 characters each), each with its source chat and date.
3. Writing: the agent only proposes. A "remember for this project" action on a standing-instruction chip promotes it, and the user confirms. The agent never writes the file without that confirmation, because a wrong line then affects every later chat.
4. Display and edit: a section in the agent panel menu lists the lines, with edit and delete.
5. Injection: the server reads the file once per turn and adds it to the same `<standing_instructions>` block, marked as project memory. A preference in the chat wins over project memory.

Build (a) first. Its chips are the input that (b) promotes, and it removes the daily problem without new storage.
