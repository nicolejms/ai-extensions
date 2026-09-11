import {
  createContext,
  createElement as h,
  useContext,
  useLayoutEffect,
  useRef
} from "react";
import { Handle, Position } from "reactflow";
import type { ReactElement, ReactNode, MouseEvent } from "react";
import type { NodeProps } from "reactflow";
import { isLocalSourceNode } from "./build.js";
import { safeExternalUrl } from "./external-url.js";
import { githubSourceReferenceUrl } from "./model.js";
import type { GraphNodeData, GraphSettings } from "./build.js";
import type { GraphCallbacks } from "./callbacks.js";

export interface NodeInteraction {
  settings: GraphSettings;
  callbacks: GraphCallbacks;
  showDetails(node: GraphNodeData, card: HTMLElement, toggle: boolean): void;
}

export const NodeInteractionContext = createContext<NodeInteraction | null>(
  null
);

interface MeasuredElement {
  scrollWidth: number;
  clientWidth: number;
  style: { fontSize: string };
}

export function fitTypeLabel(element: MeasuredElement): number {
  let size = 13;
  element.style.fontSize = size + "px";
  while (element.scrollWidth > element.clientWidth && size > 7) {
    size -= 0.5;
    element.style.fontSize = size + "px";
  }
  return size;
}

export function ResourceNode({ data }: NodeProps<GraphNodeData>): ReactElement {
  const interaction = useContext(NodeInteractionContext);
  if (!interaction)
    throw new Error("ResourceNode must be rendered inside RadiusGraph.");
  const { settings, callbacks, showDetails } = interaction;
  const cardRef = useRef<HTMLDivElement>(null);
  const typeRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (typeRef.current) fitTypeLabel(typeRef.current);
  }, [data.typeLabel]);

  const glyph = h("span", { className: "rad-node__source-glyph" }, "</>");
  const label = h("span", null, "View source code");
  const local = isLocalSourceNode(settings, data);
  const sourceUrl = safeExternalUrl(data.sourceUrl);
  let source: ReactNode = null;
  if (!settings.liveMode) {
    if (local && data.srcPath && callbacks.onOpenSource) {
      source = h(
        "a",
        {
          className: "rad-node__source nodrag nopan nokey",
          href: sourceUrl || "#",
          onClick: (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            callbacks.onOpenSource?.({
              path: data.srcPath,
              line: data.srcLine,
              fallbackUrl: sourceUrl
            });
          }
        },
        glyph,
        label
      );
    } else if (
      sourceUrl &&
      (!local || data.srcPath || githubSourceReferenceUrl(data.codeRef))
    ) {
      source = h(
        "a",
        {
          className: "rad-node__source nodrag nopan nokey",
          href: sourceUrl,
          target: "_blank",
          rel: "noopener noreferrer",
          onClick: (event: MouseEvent) => {
            event.stopPropagation();
            if (callbacks.onOpenExternal) {
              event.preventDefault();
              callbacks.onOpenExternal(sourceUrl);
            }
          }
        },
        glyph,
        label
      );
    } else {
      source = h(
        "span",
        {
          className: "rad-node__source",
          role: "button",
          "aria-disabled": "true",
          title: "No source reference found",
          style: { opacity: 0.5, cursor: "default" }
        },
        glyph,
        label
      );
    }
  }

  const badge =
    data.deployBadge ?
      h("img", {
        className: "rad-node__badge",
        src: data.deployBadge,
        alt:
          data.deployBadgeKind === "failed" ? "Failed"
          : data.deployBadgeKind === "success" ? "Deployed"
          : "In progress"
      })
    : null;
  const head = h(
    "div",
    {
      className:
        badge ? "rad-node__head rad-node__head--with-badge" : "rad-node__head"
    },
    data.icon ?
      h("img", { className: "rad-node__icon", src: data.icon, alt: "" })
    : null,
    h(
      "span",
      { className: "rad-node__title", title: data.nodeName },
      data.nodeName
    )
  );
  const type = h(
    "div",
    { className: "rad-node__type", ref: typeRef, title: data.typeLabel },
    data.typeLabel
  );
  const portalUrl = settings.deployMode ? safeExternalUrl(data.portalUrl) : "";
  const content =
    portalUrl ?
      h(
        "a",
        {
          className: "rad-node__portal nodrag nopan nokey",
          href: portalUrl,
          target: "_blank",
          rel: "noopener noreferrer",
          "aria-label": `Open ${data.nodeName} in Azure Portal`,
          onClick: (event: MouseEvent) => event.stopPropagation()
        },
        head,
        type
      )
    : h("div", { className: "rad-node__content" }, head, type);

  return h(
    "div",
    { className: "rad-node-shell" },
    h(Handle, {
      type: "target",
      position: Position.Top,
      isConnectable: false,
      className: "rad-handle"
    }),
    h(
      "div",
      {
        ref: cardRef,
        className: "rad-node",
        role: "group",
        "aria-label": data.nodeName,
        "data-node-id": data.id,
        style: {
          boxSizing: "border-box",
          background: data.bgColor,
          borderStyle: data.borderStyle || "solid",
          borderWidth: data.borderWidth + "px",
          borderColor: data.borderColor
        },
        onClick: (event: MouseEvent<HTMLDivElement>) =>
          showDetails(data, event.currentTarget, false)
      },
      settings.enablePopup ?
        h(
          "button",
          {
            type: "button",
            className: "rad-node__dots nodrag nopan nokey",
            "aria-label": "Show details",
            onClick: (event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              if (cardRef.current) showDetails(data, cardRef.current, true);
            }
          },
          "\u2022\u2022\u2022"
        )
      : null,
      badge,
      content,
      source,
      settings.liveMode && data.provisioningState ?
        h(
          "div",
          {
            className: "rad-node__status",
            "aria-label": `Provisioning status: ${data.provisioningState}`
          },
          data.provisioningState
        )
      : null,
      callbacks.onNavigate ?
        h(
          "button",
          {
            type: "button",
            className: "rad-node__source nodrag nopan nokey",
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              callbacks.onNavigate?.(data);
            }
          },
          `Open ${data.nodeName}`
        )
      : null
    ),
    h(Handle, {
      type: "source",
      position: Position.Bottom,
      isConnectable: false,
      className: "rad-handle"
    })
  );
}
