# Radius graph React library

`@radius-project/graph-react` renders a Radius application graph in an ordinary React tree. The Canvas adapter and external consumers use the same node builder, Dagre layout, React Flow components, details panel, and legends. Hosts may retain the default appearance or supply their own stylesheet without replacing any renderer. It does not fetch graph data, open source files over HTTP, know about Copilot or Backstage, or create a service or iframe.

This implementation is an isolated candidate, **not a qualified dashboard replacement or stable-release recommendation**. See [qualification gates](#qualification-gates).

## React usage

Install the graph package, `@radius-project/core`, and matching React/ReactDOM peers in the host. Import the stylesheet once. Keep graph and options references stable between unrelated host renders; replace the graph object when its data changes.

```tsx
import { RadiusGraph } from "@radius-project/graph-react";
import "@radius-project/graph-react/styles.css";
import { normalizeLiveGraph } from "@radius-project/core/graph";

const graph = normalizeLiveGraph(ucpResponse, {
  connectionId: "production-connection",
  plane: { type: "radius", name: "local" },
  applicationId:
    "/planes/radius/local/resourceGroups/default/providers/Radius.Core/applications/store"
});

export function ApplicationGraph() {
  return (
    <div style={{ height: 600 }}>
      <RadiusGraph
        graph={graph}
        theme={{ colorScheme: "light", accent: "#0969da" }}
        options={{ showLegend: true }}
        callbacks={{
          onNavigate: (node) => navigateToResource(node.id),
          onSelect: (node) => selectResource(node.id)
        }}
      />
    </div>
  );
}
```

The host owns loading, retrieval failures, connection selection, permissions, and cache lifetime. The graph renders empty data explicitly and surfaces normalization/layout diagnostics. `graphContextKey` provides an identity containing the connection, plane, and full application ID; display names are not cache keys.

`parseResourceId` from `@radius-project/core/domain` parses full UCP IDs, including nested resource types and names. Both core subpaths are UI-agnostic and browser-safe; browser consumers should not import the server-oriented core root barrel.

## Input semantics

| Input kind            | Contract                                                                                                                                                                                             |
|-----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `live`                | Normalized UCP resources identified by full IDs; raw optional provisioning status; no diff hashes, inferred deployment success, modeled source links, Canvas visibility filter, or output expansion. |
| `modeled`             | Canvas modeled resources; hide visualization-only image/registry-secret nodes and expand concrete outputs.                                                                                           |
| `planned`             | Preserve modeled resource identity/topology, show representative resolved types, and use planned styling.                                                                                            |
| `deployed-projection` | Preserve modeled topology and explicit workflow deployment status; this is not a live UCP inventory.                                                                                                 |
| `diff`                | Preserve explicit node/connection changes, output expansion, and base/head source provenance.                                                                                                        |

The public component's discriminant selects the mode. Legacy boolean mode flags are confined to presentation helpers and the thin Canvas compatibility adapter.

`normalizeLiveGraph(payload, context, options?)` accepts an unknown payload and validates essential fields. UCP `Outbound` is presented as target-to-owner, and `Inbound` as owner-to-target. The optional `legacyGatewayDirection` correction applies only to `Applications.Core/gateways`; it is off by default. Normalization never mutates the original payload or changes the meaning of its connection records.

Identical duplicate resource records are coalesced with a diagnostic. Conflicting duplicate records fail explicitly. Malformed, missing-target, and self-referential connections are omitted with actionable diagnostics; surviving resources remain visible. The no-self-loop rule follows the authoritative dashboard plan's GU-06 intended invariant, which records the incumbent self-loop as a known defect. Reciprocal connections producing the same presentation edge are deduplicated.

## Host capabilities

`callbacks` provides optional `onSelect`, `onDetails`, `onNavigate`, `onOpenExternal`, `onOpenSource`, and `onRetry` functions. Source callbacks receive `{ path, line, fallbackUrl }`. The library does not implement editor opening or fallback networking. Without an external-opening callback, valid HTTPS links retain native browser navigation. Source locality is explicitly supplied through `localSource` or `workspaceBranch`; removed diff resources retain their base-branch source.

`options` supports legends, popup enablement, edge style, repository URL, source branches, and locality. `theme` supports background, text, muted text, accent, font family, and color scheme. Appearance belongs to the host through the [styling contract](#styling-contract).

The component fills a sized container. The default skin retains its existing 450px minimum height; custom appearance has no minimum container height. Canvas continues to own its normal-flow legend and 450px drawing area. `.radius-graph` and `.radius-graph__viewport` are supported geometry hooks.

Each component has independent layout, viewport, overlay, and timer state. Status-only updates preserve the viewport; changed node membership refits it. Details controls work by keyboard, Escape closes the overlay and restores focus, and teardown releases roots/listeners/timers. The details overlay is a React-rendered element: it is anchored beside the card it describes, follows that card when a relayout or drag moves it, closes when its node leaves the data, and stays mounted while closed if the graph is non-empty. A partial layout preserves valid placements and the unplaced nodes' prior positions, with a visible diagnostic. A wholly missing, non-finite, or failed layout produces readable stacked cards and a degraded-layout message.

Inline `options` and `callbacks` objects are safe. A host render that reallocates them keeps an open details overlay, its restorable focus, and any dragged node positions, and the newest callback closures still receive events. Replace `graph` only when the data itself changes, because new node membership intentionally refits the viewport.

For a server-rendered shell, `mountRadiusGraph(element, props)` mounts this same component and returns `update(props): boolean` and idempotent `unmount()`. It is a compatibility boundary, not a separate renderer. Canvas keeps SDK interaction, local HTTP, source-opening fallback, worktree context, and workflow orchestration in `packages/adapter-canvas`.

## Styling contract

Choose one CSS entry point. Neither is imported automatically by JavaScript or downloaded at runtime:

| Entry point                              | Ownership                                                                                                                                                  |
|------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `@radius-project/graph-react/styles.css` | Required base styles plus the existing default skin. Existing consumers and Canvas need no change.                                                         |
| `@radius-project/graph-react/base.css`   | Required graph geometry, hit testing, and the pinned React Flow vendor CSS, without the Radius skin. Use with `appearance="custom"` and a host stylesheet. |

The same React tree implements both appearances. `appearance="custom"` disables the default skin for that instance even if another graph imports `styles.css` in the same document. `appearance` defaults to `"default"`. The default skin uses CSS `@scope` (a browser supporting `@scope` is required); host styles for custom instances do not need it. Radius-authored CSS is confined to graph elements. The bundled React Flow stylesheet retains its upstream `.react-flow` namespace: this is not Shadow DOM isolation, and hosts with other React Flow instances should coordinate that vendor version and stylesheet. Broad host resets can still affect the graph.

### Keep the default appearance, change tokens

Use `theme` for the original palette API, or set public CSS custom properties in a host stylesheet or the typed `GraphStyle` prop:

```tsx
import type { GraphStyle } from "@radius-project/graph-react";

const style: GraphStyle = {
  "--radius-graph-accent": "var(--host-link)",
  "--radius-graph-font": "var(--host-font)",
  "--radius-graph-node-radius": "4px",
  "--radius-graph-details-radius": "4px",
  "--radius-graph-edge-width": "3"
};

<RadiusGraph graph={graph} style={style} />;
```

Public tokens are `--radius-graph-background`, `--radius-graph-text`, `--radius-graph-muted`, `--radius-graph-accent`, `--radius-graph-font`, `--radius-graph-danger`, `--radius-graph-added`, `--radius-graph-modified`, `--radius-graph-removed`, `--radius-graph-node-background`, `--radius-graph-node-border`, `--radius-graph-node-radius`, `--radius-graph-details-background`, `--radius-graph-details-radius`, `--radius-graph-edge-color`, and `--radius-graph-edge-width`. Node color overrides intentionally replace semantic default fills/borders; preserve distinguishable diff/status states when using them. Only explicitly supplied `theme` values override corresponding `style` tokens. Omitting a theme value leaves inline or inherited host tokens intact.

### Supply a host stylesheet

```tsx
import { RadiusGraph } from "@radius-project/graph-react";
import "@radius-project/graph-react/base.css";
import "./application-graph.css";

<div style={{ height: 600 }}>
  <RadiusGraph graph={graph} appearance="custom" className="application-graph" />
</div>;
```

```css
.application-graph {
  font-family: var(--host-font, sans-serif);
  color: var(--host-text, #102a43);
  background: var(--host-background, #f0f4f8);
}
.application-graph [data-radius-part="node"] {
  background: var(--host-card, white);
  border: 2px solid var(--host-border, #627d98);
  border-radius: 4px;
  padding: 12px;
}
.application-graph [data-radius-part="node-type"] {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.application-graph [data-radius-part="details"] {
  background: var(--host-card, white);
  border: 1px solid var(--host-border, #627d98);
  padding: 12px;
}
.application-graph [data-radius-part="details-link"] {
  color: var(--host-link, #005a9c);
}
.application-graph .radius-graph__edge .react-flow__edge-path {
  stroke: var(--host-border, #627d98);
}
.application-graph :focus-visible {
  outline: 3px solid var(--host-link, #005a9c);
  outline-offset: 3px;
}
```

This is a starting palette, not a complete design system. The host owns readable contrast, visible focus, disabled/error styling, and distinguishable semantic states. Customize these stable `data-radius-part` values rather than depending on private markup:

| Surface       | Parts                                                                                                                                                 |
|---------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| Graph         | `viewport`, `legend`, `legend-item`, `legend-icon`, `warning`, `empty`, `error`, `retry`                                                              |
| Resource card | `node`, `node-title`, `node-type`, `icon`, `badge`, `source`, `navigate`, `status`, `details-toggle`                                                  |
| Details panel | `details`, `details-summary`, `details-status`, `details-row`, `details-link`, `details-icon`, `details-subtitle`, `details-message`, `details-empty` |

The root exposes `data-radius-kind`; cards expose `data-radius-diff`, `data-radius-deploy`, and optional `data-radius-provisioning`; details messages expose `data-radius-failure`. These are raw model states, not new status classifications. `aria-disabled` still marks unavailable source actions. CSS can select these attributes without changing graph data or callbacks. Built-in resource and deploy glyphs remain image assets: CSS can size or hide them but cannot recolor the internals of a data-URI image. Do not hide the only status indicator without supplying an accessible alternative.

The supported vendor hooks are `.radius-graph__edge .react-flow__edge-path`, `.react-flow__controls`, `.react-flow__controls-button`, and `.react-flow__background` beneath your root class. Keep node positioning, transforms, handles, hit testing, and the fixed 220px node width intact: Dagre owns those contracts. Arbitrarily sized/replaced nodes are not supported. Custom appearance releases automatic type-label shrinking so the host can choose typography and wrapping; default appearance retains it. Details positioning and hidden state remain inline because they are behavior, not appearance. All other node, edge, legend, and details paint comes from CSS.

Changing `appearance`, `theme`, `className`, or a stylesheet does not rebuild graph data, reset the viewport, or replace open details. Style changes that substantially alter content height may require the user to fit the graph with the existing controls; they do not trigger an unsolicited viewport reset. The callback, keyboard, focus-restoration, status, and teardown contracts are the same in both appearances.

## Packaging and provenance

The package exports JavaScript and declarations, bundled `styles.css` and `base.css`, and a `presentation` subpath for typed graph presentation helpers. React and ReactDOM remain peers. Canvas bundles shared source into its existing self-contained browser artifact, ultimately `.artifacts/radius/com.github.copilot/extensions/radius/extension.mjs`; no package source is downloaded at runtime. Library release/version handling is separate from Copilot plugin discovery and release selection. No public registry publication is part of this implementation.

The renderer and its existing pure/browser scenarios were extracted from `ai-extensions` at `172782e`. The old Canvas renderer, layout, details, legend, model, and graph-specific stylesheet ownership were removed rather than copied into a second implementation. Canvas callers import the shared public API directly; no legacy graph forwarding modules remain.

The design inputs are `docs/design/2026-09-radius-backstage-plugin.md` and `docs/design/2026-09-dashboard-plugin-test-plan.md` from dashboard commit `fd90d938267ceab5935b037bc7dd1ff59831e8b5`. The live normalization implementation and local fixtures are independently authored from those contracts. Dashboard implementation/fixture code was not copied because its package/repository license discrepancy remains unresolved.

## Qualification gates

`pnpm run coverage` and `pnpm run test:reliability` both discover the shared graph's Node and real Chromium suites alongside the Canvas host tests owned by each gate. The scheduled reliability workflow installs Chromium on each supported operating system. The shared package retains the original Canvas browser branch floor of 99.5%, with statements, functions, and lines pinned at 100%.

Local package and component checks cannot substitute for the required dashboard-host gate. At the pinned dashboard revision, phases 0 and 3 are complete, phases 1 and 2 are in progress, and phase 4 onward has not started. GU-01 through GU-10 Tier A fixtures/invariants exist; that is not a frozen regression baseline.

The dashboard-owned CP-01 through CP-05 candidate pin/install/external-host seam, GU-20 real-renderer/stylesheet-negative journeys, GU-21 through GU-24 records/manifest, and Tier B real-renderer journeys remain prerequisites. Tests in this fork must use the exact packed candidate JS/declarations/CSS and transitive core resolution with matching React 18 and React 19 hosts, but even passing isolated checks cannot discharge those absent consumer gates.

The implementation must not be described as fully dashboard-regression-tested or ready for stable merge/publication until those prerequisites and mandatory consumer CI are available and pass. Do not upgrade the dashboard to React 19 or migrate React Flow merely to make an isolated candidate pass.
