import {
  Component,
  createElement as h,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import ReactFlow, {
  Background,
  Controls,
  useEdgesState,
  useNodesState
} from "reactflow";
import dagre from "dagre";
import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode } from "react";
import type { ReactFlowInstance } from "reactflow";
import type {
  GraphResource,
  RadiusGraphData
} from "@radius-project/core/graph";
import { graphContextKey } from "@radius-project/core/graph";
import { buildGraph, resolveGraphSettings } from "./build.js";
import type { GraphNodeData, GraphOptions, GraphSettings } from "./build.js";
import {
  anchorPosition,
  buildDetailRows,
  closesDetails,
  focusReturnTarget
} from "./details.js";
import type { FocusTarget } from "./details.js";
import { DetailsOverlay } from "./details-panel.js";
import { layoutGraph } from "./layout.js";
import {
  buildCategoryLegendHtml,
  buildStatusLegendHtml,
  collectLegendCategories
} from "./legend.js";
import { NodeInteractionContext, ResourceNode } from "./node.js";
import type { GraphCallbacks } from "./callbacks.js";
import { graphStyle, styledEdges } from "./theme.js";
import type { GraphStyle, GraphTheme } from "./theme.js";
export type { GraphStyle, GraphTheme } from "./theme.js";

export interface RadiusGraphProps {
  graph: RadiusGraphData;
  options?: Omit<
    GraphOptions,
    "liveMode" | "diffMode" | "deployMode" | "plannedMode"
  >;
  theme?: GraphTheme;
  /** Use the default skin or let the host stylesheet own appearance. */
  appearance?: "default" | "custom";
  callbacks?: GraphCallbacks;
  className?: string;
  style?: GraphStyle;
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

interface OpenDetails {
  id: string;
  card: HTMLElement;
  left: number;
  top: number;
}

function GraphContent({
  graph,
  appearance,
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
  const enablePopup = settings.enablePopup;
  const built = useMemo(() => {
    const resources: GraphResource[] = graph.resources.map((resource) => ({
      ...resource,
      connections: resource.connections ? [...resource.connections] : []
    }));
    const result = buildGraph(settings, resources);
    const warning = layoutGraph(dagre, result.nodes, result.edges);
    return { ...result, edges: styledEdges(result.edges), warning };
  }, [graph, settings]);
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNodeData>(
    built.nodes
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(built.edges);
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // Which node's details are open, the card they are anchored to, and where
  // that put them. React owns the panel, so this is ordinary component state
  // rather than a handle on a detached element.
  const [details, setDetails] = useState<OpenDetails | null>(null);
  // Event handlers must stay referentially stable to keep the memoized node
  // context intact, so they read the open panel through a mirror of the state
  // instead of closing over it.
  const detailsRef = useRef<OpenDetails | null>(null);
  const restoreFocusRef = useRef<FocusTarget | null>(null);
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
  const applyDetails = useCallback((next: OpenDetails | null) => {
    detailsRef.current = next;
    setDetails(next);
  }, []);
  const closeDetails = useCallback(() => {
    if (!detailsRef.current) return;
    applyDetails(null);
    // Return focus where it was before the panel took it, so keyboard users
    // are not dropped at the top of the document.
    const restore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    restore?.focus();
  }, [applyDetails]);

  useEffect(() => {
    setNodes(built.nodes);
    setEdges(built.edges);
    // The panel reads its rows from the newest build, so refreshed data shows
    // without reopening. A node that disappeared takes its panel with it.
    const open = detailsRef.current;
    if (open && !built.dataById[open.id]) closeDetails();
    if (signature !== previousSignature.current) {
      previousSignature.current = signature;
      scheduleFit();
      closeDetails();
    }
  }, [built, signature, scheduleFit, setNodes, setEdges, closeDetails]);

  // Re-anchor an open panel once the cards it points at have been laid out
  // again, so a relayout or a drag does not leave it behind.
  useEffect(() => {
    const open = detailsRef.current;
    if (!open) return;
    const moved = anchorPosition(viewportRef.current, open.card);
    if (moved.left !== open.left || moved.top !== open.top) {
      applyDetails({ ...open, ...moved });
    }
  }, [nodes, applyDetails]);

  const showDetails = useCallback(
    (node: GraphNodeData, card: HTMLElement, toggle: boolean) => {
      callbacksRef.current.onSelect?.(node);
      if (!enablePopup) return;
      const open = detailsRef.current;
      // Clicking the same card's "…" button again closes the panel; a
      // different card re-anchors it.
      if (toggle && open?.card === card) {
        closeDetails();
        callbacksRef.current.onDetails?.(node, false);
        return;
      }
      if (!open) {
        restoreFocusRef.current = focusReturnTarget(
          card.ownerDocument.activeElement
        );
      }
      applyDetails({
        id: node.id,
        card,
        ...anchorPosition(viewportRef.current, card)
      });
      callbacksRef.current.onDetails?.(node, true);
    },
    [applyDetails, closeDetails, enablePopup]
  );

  // Clicking the empty pane, the controls or the legend closes the panel.
  // Clicking a card or the panel itself does not: those have their own
  // handlers.
  const onViewportClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!detailsRef.current) return;
      if (closesDetails(event.target)) closeDetails();
    },
    [closeDetails]
  );
  const onViewportKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") closeDetails();
    },
    [closeDetails]
  );

  const openData = details ? built.dataById[details.id] : undefined;
  const rows = useMemo(
    () => (openData ? buildDetailRows(settings, openData) : []),
    [openData, settings]
  );
  const interaction = useMemo(
    () => ({ settings, callbacks: stableCallbacks, showDetails, appearance }),
    [settings, stableCallbacks, showDetails, appearance]
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
        "data-radius-part": "legend",
        dangerouslySetInnerHTML: { __html: legend }
      })
    : null,
    built.warning ?
      h(
        "div",
        {
          role: "status",
          className: "radius-graph__warning",
          "data-radius-part": "warning"
        },
        built.warning
      )
    : null,
    graph.kind === "live" && graph.warnings.length > 0 ?
      h(
        "div",
        {
          role: "status",
          className: "radius-graph__warning",
          "data-radius-part": "warning"
        },
        graph.warnings.join(" ")
      )
    : null,
    h(
      "div",
      {
        className: "radius-graph__viewport",
        "data-radius-part": "viewport",
        ref: viewportRef,
        onClick: onViewportClick,
        onKeyDown: onViewportKeyDown
      },
      built.nodes.length === 0 ?
        h(
          "div",
          {
            role: "status",
            className: "radius-graph__empty",
            "data-radius-part": "empty"
          },
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
        ),
      enablePopup && built.nodes.length > 0 ?
        h(DetailsOverlay, {
          id: `node-popup-${panelId}`,
          rows,
          open: openData !== undefined,
          left: details?.left ?? 0,
          top: details?.top ?? 0,
          onOpenExternal: stableCallbacks.onOpenExternal,
          onOpenLocalSource:
            stableCallbacks.onOpenSource ?
              (path, line, fallbackUrl) =>
                stableCallbacks.onOpenSource?.({ path, line, fallbackUrl })
            : undefined
        })
      : null
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
      {
        className: "radius-graph__error",
        role: "alert",
        "data-radius-part": "error"
      },
      "The application graph could not be rendered. ",
      this.props.onRetry ?
        h(
          "button",
          {
            type: "button",
            onClick: this.props.onRetry,
            "data-radius-part": "retry"
          },
          "Reload graph"
        )
      : null
    );
  }
}

/** The same controlled React tree is mounted by Canvas and npm consumers. */
export function RadiusGraph(props: RadiusGraphProps): ReactElement {
  return h(
    "section",
    {
      className: `radius-graph${props.className ? ` ${props.className}` : ""}`,
      style: graphStyle(props.style, props.theme),
      "data-radius-appearance": props.appearance ?? "default",
      "data-radius-kind": props.graph.kind,
      "aria-label": props.ariaLabel || "Application graph"
    },
    h(
      GraphBoundary,
      { identity: props.graph, onRetry: props.callbacks?.onRetry },
      h(GraphContent, props)
    )
  );
}
