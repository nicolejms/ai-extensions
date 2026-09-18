import { describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  createRadiusClaudeServer,
  GRAPH_RESOURCE_URI,
  GRAPH_TOOL_NAME
} from "./server.js";
import type { RadiusClaudeServerDependencies } from "./server.js";

async function createHarness(dependencies: RadiusClaudeServerDependencies) {
  const server = createRadiusClaudeServer(dependencies);
  const client = new Client({
    name: "adapter-claude-test",
    version: "1.0.0"
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}

describe("createRadiusClaudeServer", () => {
  it("registers the graph tool and its MCP App resource", async () => {
    const harness = await createHarness({
      loadGraph: async () => ({
        status: "ready",
        definitionFile: ".radius/app.bicep",
        graph: {
          kind: "modeled",
          resources: [
            { id: "web", name: "web", type: "Radius.Compute/containers" }
          ]
        }
      }),
      readAppHtml: async () => "<html>radius graph</html>"
    });
    try {
      const { tools } = await harness.client.listTools();
      const graphTool = tools.find((tool) => tool.name === GRAPH_TOOL_NAME);
      expect(graphTool?._meta).toMatchObject({
        ui: { resourceUri: GRAPH_RESOURCE_URI }
      });

      const result = await harness.client.callTool({
        name: GRAPH_TOOL_NAME,
        arguments: {}
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        status: "ready",
        definitionFile: ".radius/app.bicep"
      });
      expect(result.content).toContainEqual({
        type: "text",
        text: "Rendered 1 Radius resource from .radius/app.bicep."
      });

      const resource = await harness.client.readResource({
        uri: GRAPH_RESOURCE_URI
      });
      expect(resource.contents[0]).toMatchObject({
        uri: GRAPH_RESOURCE_URI,
        text: "<html>radius graph</html>"
      });
    } finally {
      await harness.close();
    }
  });

  it("returns an explicit tool failure when graph loading fails", async () => {
    const harness = await createHarness({
      loadGraph: async () => {
        throw new Error("rad compile failed");
      },
      readAppHtml: async () => "<html></html>"
    });
    try {
      const result = await harness.client.callTool({
        name: GRAPH_TOOL_NAME,
        arguments: { appBicepPath: "custom/app.bicep" }
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        status: "error",
        message: "rad compile failed",
        requestedPath: "custom/app.bicep"
      });
    } finally {
      await harness.close();
    }
  });

  it("rejects invalid tool arguments through the declared schema", async () => {
    const harness = await createHarness({
      loadGraph: async () => {
        throw new Error("should not run");
      },
      readAppHtml: async () => "<html></html>"
    });
    try {
      const result = await harness.client.callTool({
        name: GRAPH_TOOL_NAME,
        arguments: { appBicepPath: "" }
      });

      expect(result.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("describes plural resource counts", async () => {
    const harness = await createHarness({
      loadGraph: async () => ({
        status: "ready",
        definitionFile: "app.bicep",
        graph: {
          kind: "modeled",
          resources: [{ id: "api" }, { id: "database" }]
        }
      }),
      readAppHtml: async () => "<html></html>"
    });
    try {
      const result = await harness.client.callTool({
        name: GRAPH_TOOL_NAME,
        arguments: {}
      });

      expect(result.content).toContainEqual({
        type: "text",
        text: "Rendered 2 Radius resources from app.bicep."
      });
    } finally {
      await harness.close();
    }
  });
});
