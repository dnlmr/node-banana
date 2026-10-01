/**
 * The prompting tips saved for one model (`?provider=&modelId=`): GET reads
 * them (`{ notes: null }` when none), DELETE forgets them. The agent writes
 * them in a research turn; this route only lets the panel show and remove
 * them. Same-origin only, like the other agent routes.
 */

import { NextRequest, NextResponse } from "next/server";

import { filePromptNotesStore, type PromptNotesEntry } from "@/lib/agent/prompting/notesStore";
import { checkSameOrigin } from "@/lib/agent/server/sameOrigin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AgentPromptNotesResponse {
  notes?: PromptNotesEntry | null;
  removed?: boolean;
  error?: string;
}

function target(request: NextRequest): { provider: string; modelId: string } | null {
  const provider = request.nextUrl.searchParams.get("provider")?.trim() ?? "";
  const modelId = request.nextUrl.searchParams.get("modelId")?.trim() ?? "";
  if (!provider || !modelId || provider.length > 40 || modelId.length > 200) return null;
  return { provider, modelId };
}

function guard(request: NextRequest): NextResponse<AgentPromptNotesResponse> | { provider: string; modelId: string } {
  const origin = checkSameOrigin(request);
  if (!origin.ok) return NextResponse.json({ error: origin.reason }, { status: 403 });
  const model = target(request);
  if (!model) return NextResponse.json({ error: "provider and modelId are required." }, { status: 400 });
  return model;
}

export async function GET(request: NextRequest) {
  const model = guard(request);
  if (model instanceof NextResponse) return model;
  const notes = await filePromptNotesStore().read(model.provider, model.modelId);
  return NextResponse.json<AgentPromptNotesResponse>({ notes }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest) {
  const model = guard(request);
  if (model instanceof NextResponse) return model;
  const removed = await filePromptNotesStore().remove(model.provider, model.modelId);
  return NextResponse.json<AgentPromptNotesResponse>({ removed });
}
