import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { GRAPH_RESOURCE_URI, GRAPH_TOOL_NAME } from "../../src/contracts.js";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");
const DIST_DIR = path.join(PACKAGE_ROOT, "dist");
const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("built Claude plugin", () => {
  it("contains a valid plugin manifest, MCP configuration, and bundled app", () => {
    const manifest = JSON.parse(
      readFileSync(
        path.join(PACKAGE_ROOT, ".claude-plugin", "plugin.json"),
        "utf8"
      )
    );
    const mcp = JSON.parse(
      readFileSync(path.join(PACKAGE_ROOT, ".mcp.json"), "utf8")
    );
    const html = readFileSync(path.join(DIST_DIR, "mcp-app.html"), "utf8");

    expect(manifest).toMatchObject({
      name: "radius",
      version: "0.1.0"
    });
    expect(mcp.mcpServers.radius).toEqual({
      command: "node",
      args: ["${CLAUDE_PLUGIN_ROOT}/dist/server.mjs", "--stdio"]
    });
    expect(html).toContain("Radius application graph");
    expect(html).toMatch(/<style>[\s\S]+<\/style>/);
    expect(html).toMatch(/<div id="root"><\/div>\s*<script>[\s\S]+<\/script>/);
  });

  it("starts over stdio, registers the app, and fails closed without a model", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "radius-claude-"));
    workspaces.push(workspace);
    const client = new Client({
      name: "adapter-claude-artifact-test",
      version: "1.0.0"
    });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(DIST_DIR, "server.mjs"), "--stdio"],
        cwd: workspace,
        stderr: "pipe"
      })
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain(GRAPH_TOOL_NAME);

      const result = await client.callTool({
        name: GRAPH_TOOL_NAME,
        arguments: {}
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        status: "error",
        message: expect.stringContaining("No Radius application definition")
      });

      const resource = await client.readResource({
        uri: GRAPH_RESOURCE_URI
      });
      expect(resource.contents[0]?.mimeType).toContain("text/html");
    } finally {
      await client.close();
    }
  });
});
