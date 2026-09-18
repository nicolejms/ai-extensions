import { promises as fs } from "node:fs";
import path from "node:path";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { GRAPH_RESOURCE_URI, GRAPH_TOOL_NAME } from "./contracts.js";
import { loadApplicationGraph } from "./graph-loader.js";
import type { GraphLoaderInput } from "./graph-loader.js";
import { GraphToolOutputSchema } from "./graph-output.js";
import type { GraphToolOutput, ReadyGraphOutput } from "./graph-output.js";

export { GRAPH_RESOURCE_URI, GRAPH_TOOL_NAME } from "./contracts.js";

export const GraphToolInputSchema = z.object({
  appBicepPath: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional workspace-relative path to app.bicep. Defaults to .radius/app.bicep, then app.bicep."
    )
});

export interface RadiusClaudeServerDependencies {
  loadGraph(input: GraphLoaderInput): Promise<ReadyGraphOutput>;
  readAppHtml(): Promise<string>;
}

const appHtmlPath = path.join(
  import.meta.dirname,
  import.meta.filename.endsWith(".ts") ? "../dist/mcp-app.html" : "mcp-app.html"
);

const productionDependencies: RadiusClaudeServerDependencies = {
  loadGraph: (input) => loadApplicationGraph(input),
  readAppHtml: () => fs.readFile(appHtmlPath, "utf8")
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function describeGraph(output: ReadyGraphOutput): string {
  const count = output.graph.resources.length;
  const noun = count === 1 ? "resource" : "resources";
  return `Rendered ${count} Radius ${noun} from ${output.definitionFile}.`;
}

function errorOutput(
  error: unknown,
  input: GraphLoaderInput
): Extract<GraphToolOutput, { status: "error" }> {
  return {
    status: "error",
    message: errorMessage(error),
    ...(input.appBicepPath ? { requestedPath: input.appBicepPath } : {})
  };
}

export function createRadiusClaudeServer(
  dependencies: RadiusClaudeServerDependencies = productionDependencies
): McpServer {
  const server = new McpServer({
    name: "Radius for Claude Code",
    version: "0.1.0"
  });

  registerAppTool(
    server,
    GRAPH_TOOL_NAME,
    {
      title: "Show Radius application graph",
      description:
        "Build the current workspace's Radius app.bicep and display its interactive application graph.",
      inputSchema: GraphToolInputSchema,
      outputSchema: GraphToolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true
      },
      _meta: {
        ui: {
          resourceUri: GRAPH_RESOURCE_URI
        }
      }
    },
    async (input) => {
      try {
        const output = await dependencies.loadGraph(input);
        return {
          content: [{ type: "text", text: describeGraph(output) }],
          structuredContent: output
        };
      } catch (error) {
        const output = errorOutput(error, input);
        return {
          isError: true,
          content: [{ type: "text", text: output.message }],
          structuredContent: output
        };
      }
    }
  );

  registerAppResource(
    server,
    GRAPH_RESOURCE_URI,
    GRAPH_RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Interactive Radius application graph"
    },
    async () => ({
      contents: [
        {
          uri: GRAPH_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await dependencies.readAppHtml()
        }
      ]
    })
  );

  return server;
}
