import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import { createRoot } from "react-dom/client";
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { RadiusGraph } from "@radius-project/graph-react";
import type {
  GraphCallbacks,
  GraphNodeData,
  GraphTheme
} from "@radius-project/graph-react";
import { GRAPH_TOOL_NAME } from "../contracts.js";
import { parseGraphToolOutput } from "../graph-output.js";
import type { GraphToolOutput, ReadyGraphOutput } from "../graph-output.js";

export type RadiusAppPort = Pick<
  App,
  | "ontoolinput"
  | "ontoolresult"
  | "onhostcontextchanged"
  | "connect"
  | "getHostContext"
  | "callServerTool"
  | "openLink"
  | "sendMessage"
  | "updateModelContext"
>;

type ToolResult = Awaited<ReturnType<RadiusAppPort["callServerTool"]>>;
type HostContext = McpUiHostContext;

function textContent(result: ToolResult): string {
  return result.content
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .join("\n");
}

export function outputFromToolResult(result: ToolResult): GraphToolOutput {
  const structured = parseGraphToolOutput(result.structuredContent);
  if (structured) return structured;
  return {
    status: "error",
    message:
      textContent(result) ||
      "The Radius graph tool returned an invalid response."
  };
}

function reportFailure(operation: string, error: unknown): void {
  console.error(
    `[radius] ${operation} failed:`,
    error instanceof Error ? error.message : String(error)
  );
}

export function createGraphCallbacks(app: RadiusAppPort): GraphCallbacks {
  return {
    onOpenExternal: (url) => {
      void app
        .openLink({ url })
        .catch((error) => reportFailure("Opening the link", error));
    },
    onOpenSource: ({ path, line, fallbackUrl }) => {
      const location = line > 0 ? `${path}:${line}` : path;
      void app
        .sendMessage({
          role: "user",
          content: [
            {
              type: "text",
              text:
                location ?
                  `Open ${location} from the Radius application graph.`
                : `Open ${fallbackUrl} from the Radius application graph.`
            }
          ]
        })
        .catch((error) => reportFailure("Opening source", error));
    },
    onSelect: (node: GraphNodeData) => {
      void app
        .updateModelContext({
          content: [
            {
              type: "text",
              text: `Selected Radius resource ${node.nodeName} (${node.resourceType || node.typeLabel}).`
            }
          ]
        })
        .catch((error) => reportFailure("Updating model context", error));
    }
  };
}

export interface RadiusGraphViewProps {
  output: ReadyGraphOutput;
  hostContext?: HostContext;
  callbacks: GraphCallbacks;
  refreshing: boolean;
  onRefresh(): void;
}

export function RadiusGraphView({
  output,
  hostContext,
  callbacks,
  refreshing,
  onRefresh
}: RadiusGraphViewProps) {
  const theme: GraphTheme = {
    colorScheme: hostContext?.theme,
    background: "var(--radius-app-surface)",
    text: "var(--radius-app-text)",
    mutedText: "var(--radius-app-muted)"
  };
  const count = output.graph.resources.length;
  return (
    <main
      className='radius-claude-app'
      style={{
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left
      }}
    >
      <header className='radius-claude-app__header'>
        <div>
          <h1 className='radius-claude-app__title'>Radius application graph</h1>
          <p className='radius-claude-app__meta'>
            {count} {count === 1 ? "resource" : "resources"} from{" "}
            {output.definitionFile}
          </p>
        </div>
        <button
          className='radius-claude-app__button'
          type='button'
          disabled={refreshing}
          onClick={onRefresh}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </header>
      <section className='radius-claude-app__graph'>
        <RadiusGraph
          graph={output.graph}
          options={{ localSource: true, showLegend: true }}
          theme={theme}
          callbacks={callbacks}
          ariaLabel='Radius application graph'
        />
      </section>
    </main>
  );
}

export function RadiusClaudeApp({ app }: { app: RadiusAppPort }) {
  const [output, setOutput] = useState<GraphToolOutput | null>(null);
  const [toolArguments, setToolArguments] = useState<Record<string, unknown>>(
    {}
  );
  const [hostContext, setHostContext] = useState<HostContext | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const callbacks = useMemo(() => createGraphCallbacks(app), [app]);

  useEffect(() => {
    let active = true;
    app.ontoolinput = (input) => {
      if (active) setToolArguments(input.arguments ?? {});
    };
    app.ontoolresult = (result) => {
      if (active) setOutput(outputFromToolResult(result));
    };
    app.onhostcontextchanged = (context) => {
      if (active) setHostContext(context);
    };
    setHostContext(app.getHostContext());
    void app.connect().catch((error) => {
      if (active) {
        setOutput({
          status: "error",
          message: `The Radius graph app could not connect: ${
            error instanceof Error ? error.message : String(error)
          }`
        });
      }
    });
    return () => {
      active = false;
      app.ontoolinput = undefined;
      app.ontoolresult = undefined;
      app.onhostcontextchanged = undefined;
    };
  }, [app]);

  const refresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    void app
      .callServerTool({
        name: GRAPH_TOOL_NAME,
        arguments: toolArguments
      })
      .then((result) => setOutput(outputFromToolResult(result)))
      .catch((error) =>
        setOutput({
          status: "error",
          message: `The Radius graph could not be refreshed: ${
            error instanceof Error ? error.message : String(error)
          }`
        })
      )
      .finally(() => setRefreshing(false));
  }, [app, refreshing, toolArguments]);

  if (!output) {
    return (
      <main className='radius-claude-app'>
        <p className='radius-claude-app__status' role='status'>
          Loading the Radius application graph...
        </p>
      </main>
    );
  }
  if (output.status === "error") {
    return (
      <main className='radius-claude-app'>
        <p
          className='radius-claude-app__status radius-claude-app__status--error'
          role='alert'
        >
          {output.message}
        </p>
      </main>
    );
  }
  return (
    <RadiusGraphView
      output={output}
      hostContext={hostContext}
      callbacks={callbacks}
      refreshing={refreshing}
      onRefresh={refresh}
    />
  );
}

export function mountRadiusClaudeApp(
  host: HTMLElement,
  app: RadiusAppPort
): () => void {
  const root = createRoot(host);
  root.render(createElement(RadiusClaudeApp, { app }));
  return () => root.unmount();
}
