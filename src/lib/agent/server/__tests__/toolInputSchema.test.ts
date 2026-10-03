import { describe, it, expect } from "vitest";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { AGENT_TOOL_DEFINITIONS } from "../../tools/definitions";

/**
 * The agent's tool shapes declare most arguments optional, and the models
 * omit them ("get_workflow {}", "arrange_workflow {}"). Through the SDK's
 * `core` entry, the one the harness uses, those calls must reach the handler.
 *
 * Regression: the SDK marks every optional field of a zod 4.x schema as
 * "defaulted" before registering the tool, a marker only zod 4.5+ objects
 * understand. Against zod 4.4 every omitted optional argument came back as
 * "Invalid input: expected nonoptional, received undefined", so the agent
 * could not read or arrange the canvas without guessing ids. Keeping the
 * app's zod on a release the SDK's marker works with is what this guards.
 */
describe("tool input schemas through the SDK's core MCP server", () => {
  async function connect(definitions: typeof AGENT_TOOL_DEFINITIONS, seen: Record<string, unknown[]>) {
    const server = createSdkMcpServer({
      name: "probe",
      version: "0",
      tools: definitions.map((definition) =>
        tool(definition.name, definition.description, definition.inputShape, async (args) => {
          (seen[definition.name] ??= []).push(args);
          return { content: [{ type: "text", text: "ok" }] };
        }),
      ),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(serverTransport);
    const client = new Client({ name: "probe-client", version: "0" });
    await client.connect(clientTransport);
    return client;
  }

  it("lists every tool with its optional arguments not required", async () => {
    const client = await connect(AGENT_TOOL_DEFINITIONS, {});
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name).sort()).toEqual(AGENT_TOOL_DEFINITIONS.map((d) => d.name).sort());
    for (const definition of AGENT_TOOL_DEFINITIONS) {
      const schema = listed.tools.find((t) => t.name === definition.name)?.inputSchema as {
        required?: string[];
      };
      const required = Object.entries(definition.inputShape)
        .filter(([, field]) => !(field as z.ZodType).safeParse(undefined).success)
        .map(([key]) => key)
        .sort();
      expect([definition.name, [...(schema?.required ?? [])].sort()]).toEqual([definition.name, required]);
    }
    await client.close();
  });

  it("delivers a call that omits every optional argument to the handler", async () => {
    const seen: Record<string, unknown[]> = {};
    const client = await connect(AGENT_TOOL_DEFINITIONS, seen);
    for (const name of ["get_workflow", "arrange_workflow", "get_prompt_guide"]) {
      const result = (await client.callTool({ name, arguments: {} })) as { isError?: boolean; content: unknown };
      expect([name, result.isError ?? false, JSON.stringify(result.content)]).toEqual([name, false, expect.not.stringContaining("nonoptional")]);
      expect(seen[name]).toEqual([{}]);
    }
    await client.close();
  });

  it("still rejects a wrong type for an optional argument", async () => {
    const seen: Record<string, unknown[]> = {};
    const client = await connect(AGENT_TOOL_DEFINITIONS, seen);
    const result = (await client.callTool({ name: "get_workflow", arguments: { nodeIds: "not-a-list" } })) as {
      isError?: boolean;
      content: unknown;
    };
    expect(result.isError).toBe(true);
    expect(seen.get_workflow).toBeUndefined();
    await client.close();
  });
});
