import {
  Component,
  createElement as h,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef
} from "react";
import ReactFlow, {
  Background,
  Controls,
  useEdgesState,
  useNodesState
} from "reactflow";
import dagre from "dagre";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ReactFlowInstance } from "reactflow";
import type {
  GraphResource,
  RadiusGraphData
} from "@radius-project/core/graph";
import { graphContextKey } from "@radius-project/core/graph";
import { buildGraph, resolveGraphSettings } from "./build.js";
import type { GraphNodeData, GraphOptions, GraphSettings } from "./build.js";
import { createDetailsPanel } from "./details.js";
import type { DetailsPanel } from "./details.js";
import { layoutGraph } from "./layout.js";
import {
  buildCategoryLegendHtml,
  buildStatusLegendHtml,
  collectLegendCategories
} from "./legend.js";
import { NodeInteractionContext, ResourceNode } from "./node.js";
import type { GraphCallbacks } from "./callbacks.js";

export interface GraphTheme {
  background?: string;
  text?: string;
  mutedText?: string;
  accent?: string;
  fontFamily?: string;
  colorScheme?: "light" | "dark";
}

export interface RadiusGraphProps {
  graph: RadiusGraphData;
  options?: Omit<
    GraphOptions,
    "liveMode" | "diffMode" | "deployMode" | "plannedMode"
  >;
  theme?: GraphTheme;
  callbacks?: GraphCallbacks;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

const EMPTY_CALLBACKS: GraphCallbacks = {};
const EMPTY_OPTIONS = {};
const NODE_TYPES = { rad: ResourceNode };
const FIT_OPTIONS = { padding: 0.18 };
// Only these callbacks cross a memoized boundary, so only these need a stable
// facade. `onSelect` and `onDetails` fire through a ref, and `onRetry` is read
// from props by the error boundary, so all three stay current on their own.
const FORWARDED_CALLBACKS = [
  "onOpenExternal",
  "onOpenSource",
  "onNavigate"
] as const satisfies readonly (keyof GraphCallbacks)[];

function GraphContent({
  graph,
  options = EMPTY_OPTIONS,
  callbacks = EMPTY_CALLBACKS
}: RadiusGraphProps): ReactElement {
  // Hosts routinely pass an inline options object. Keying on its identity would
  // rebuild the graph and reset dragged node positions on every unrelated host
  // render, so key on the option values instead. Every option is a primitive.
  const optionsKey = JSON.stringify(options);
  const settings: GraphSettings = useMemo(
    () =>
      resolveGraphSettings({
        ...options,
        liveMode: graph.kind === "live",
        diffMode: graph.kind === "diff",
        plannedMode: graph.kind === "planned",
        deployMode: graph.kind === "deployed-projection"
      }),
    [optionsKey, graph.kind]
  );
  const built = useMemo(() => {
    const resources: GraphResource[] = graph.resources.map((resource) => ({
      ...resource,
      connections: resource.connections ? [...resource.connections] : []
    }));
    const result = buildGraph(settings, resources);
    const warning = layoutGraph(dagre, result.nodes, result.edges);
    return { ...result, warning };
  }, [graph, settings]);
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNodeData>(
    built.nodes
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(built.edges);
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<DetailsPanel<HTMLElement> | null>(null);
  const panelId = useId();
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  // An inline callbacks object changes identity on every host render. Depending
  // on that identity would tear down and rebuild the open details panel each
  // time, losing the open node and the focus to restore. Presence still decides
  // which affordances render, so track that rather than the object.
  const callbackPresence = FORWARDED_CALLBACKS.map((name) =>
    callbacks[name] ? "1" : "0"
  ).join("");
  const stableCallbacks = useMemo<GraphCallbacks>(() => {
    const current = callbacksRef.current;
    const facade: GraphCallbacks = {};
    if (current.onOpenExternal)
      facade.onOpenExternal = (url) =>
        callbacksRef.current.onOpenExternal?.(url);
    if (current.onOpenSource)
      facade.onOpenSource = (source) =>
        callbacksRef.current.onOpenSource?.(source);
    if (current.onNavigate)
      facade.onNavigate = (node) => callbacksRef.current.onNavigate?.(node);
    return facade;
  }, [callbackPresence]);
  const signature = JSON.stringify([
    graph.kind,
    graph.kind === "live" ? graphContextKey(graph.context) : "",
    built.nodes.map((node) => node.id).sort()
  ]);
  const previousSignature = useRef(signature);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleFit = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flowRef.current?.fitView(FIT_OPTIONS);
    }, 40);
  }, []);
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    []
  );
  useEffect(() => {
    setNodes(built.nodes);
    setEdges(built.edges);
    panelRef.current?.refresh(built.dataById);
    if (signature !== previousSignature.current) {
      previousSignature.current = signature;
      scheduleFit();
      panelRef.current?.close();
    }
  }, [built, signature, scheduleFit, setNodes, setEdges]);

  useLayoutEffect(() => {
    const container = viewportRef.current;
    if (!container || !settings.enablePopup) return;
    const doc = container.ownerDocument;
    const panel = createDetailsPanel<HTMLElement>(
      {
        dom: { createElement: (tag) => doc.createElement(tag) },
        focus: {
          active: () =>
            doc.activeElement instanceof HTMLElement ? doc.activeElement : null,
          focus(element) {
            element?.focus();
            return doc.activeElement === element;
          }
        }
      },
      container,
      settings,
      {
        openExternal: stableCallbacks.onOpenExternal,
        openLocalSource:
          stableCallbacks.onOpenSource ?
            (path, line, fallbackUrl) =>
              stableCallbacks.onOpenSource?.({ path, line, fallbackUrl })
          : undefined
      },
      `node-popup-${panelId}`
    );
    panelRef.current = panel;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") panel.close();
    };
    container.addEventListener("keydown", close);
    return () => {
      container.removeEventListener("keydown", close);
      panel.destroy();
      panelRef.current = null;
    };
  }, [settings, stableCallbacks, panelId]);

  const showDetails = useCallback(
    (node: GraphNodeData, card: HTMLElement, toggle: boolean) => {
      callbacksRef.current.onSelect?.(node);
      const panel = panelRef.current;
      if (!panel) return;
      if (toggle) panel.toggle(node, card);
      else panel.open(node, card);
      callbacksRef.current.onDetails?.(node, panel.isOpen);
    },
    []
  );
  const interaction = useMemo(
    () => ({ settings, callbacks: stableCallbacks, showDetails }),
    [settings, stableCallbacks, showDetails]
  );
  const legend =
    !settings.showLegend || settings.diffMode ? ""
    : settings.deployMode ? buildStatusLegendHtml(built.resources)
    : buildCategoryLegendHtml(collectLegendCategories(built.resources));

  return h(
    NodeInteractionContext.Provider,
    { value: interaction },
    legend ?
      h("div", {
        className: "legend",
        dangerouslySetInnerHTML: { __html: legend }
      })
    : null,
    built.warning ?
      h(
        "div",
        { role: "status", className: "radius-graph__warning" },
        built.warning
      )
    : null,
    graph.kind === "live" && graph.warnings.length > 0 ?
      h(
        "div",
        { role: "status", className: "radius-graph__warning" },
        graph.warnings.join(" ")
      )
    : null,
    h(
      "div",
      { className: "radius-graph__viewport", ref: viewportRef },
      built.nodes.length === 0 ?
        h(
          "div",
          { role: "status", className: "radius-graph__empty" },
          "No resources in this application."
        )
      : h(
          ReactFlow,
          {
            nodes,
            edges,
            nodeTypes: NODE_TYPES,
            onNodesChange,
            onEdgesChange,
            fitView: true,
            fitViewOptions: FIT_OPTIONS,
            minZoom: 0.2,
            maxZoom: 2,
            nodesDraggable: true,
            nodesConnectable: false,
            nodesFocusable: false,
            edgesFocusable: false,
            elementsSelectable: true,
            proOptions: { hideAttribution: true },
            onInit: (instance: ReactFlowInstance) => {
              flowRef.current = instance;
              scheduleFit();
            }
          },
          h(Background, { gap: 16, size: 1 }),
          h(Controls, { showInteractive: false })
        )
    )
  );
}

class GraphBoundary extends Component<
  { children?: ReactNode; onRetry?: () => void; identity: RadiusGraphData },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidUpdate(previous: Readonly<{ identity: RadiusGraphData }>): void {
    if (this.state.failed && previous.identity !== this.props.identity) {
      this.setState({ failed: false });
    }
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return h(
      "div",
      { className: "radius-graph__error", role: "alert" },
      "The application graph could not be rendered. ",
      this.props.onRetry ?
        h(
          "button",
          { type: "button", onClick: this.props.onRetry },
          "Reload graph"
        )
      : null
    );
  }
}

/** The same controlled React tree is mounted by Canvas and npm consumers. */
export function RadiusGraph(props: RadiusGraphProps): ReactElement {
  const theme = props.theme;
  const style: CSSProperties &
    Record<`--radius-graph-${string}`, string | undefined> = {
    ...props.style,
    ...(theme?.colorScheme ? { colorScheme: theme.colorScheme } : {}),
    "--radius-graph-background": theme?.background,
    "--radius-graph-text": theme?.text,
    "--radius-graph-muted": theme?.mutedText,
    "--radius-graph-accent": theme?.accent,
    "--radius-graph-font": theme?.fontFamily
  };
  return h(
    "section",
    {
      className: `radius-graph${props.className ? ` ${props.className}` : ""}`,
      style,
      "aria-label": props.ariaLabel || "Application graph"
    },
    h(
      GraphBoundary,
      { identity: props.graph, onRetry: props.callbacks?.onRetry },
      h(GraphContent, props)
    )
  );
}
