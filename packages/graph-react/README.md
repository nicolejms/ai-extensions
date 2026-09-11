# Radius graph React library

`@radius-project/graph-react` renders a Radius application graph in an ordinary React tree. The Canvas adapter and external consumers use the same node builder, Dagre layout, React Flow components, details panel, legends, and styles. It does not fetch graph data, open source files over HTTP, know about Copilot or Backstage, or create a service or iframe.

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
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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

`options` supports legends, popup enablement, edge style, repository URL, source branches, and locality. `theme` supports background, text, muted text, accent, font family, and color scheme. All custom styles are scoped under `.radius-graph`; the bundled React Flow vendor stylesheet uses its upstream `.react-flow` namespace. Additional semantic CSS inputs are `--radius-graph-danger`, `--radius-graph-added`, `--radius-graph-modified`, and `--radius-graph-removed`.

The component fills its container. `.radius-graph` and its drawing area `.radius-graph__viewport` are a supported styling contract, so a host that owns the surrounding layout can size the drawing area itself; every other class under `.radius-graph` is internal and may change. The package deliberately ships no height of its own.

Each component has independent layout, viewport, overlay, and timer state. Status-only updates preserve the viewport; changed node membership refits it. Details controls work by keyboard, Escape closes the overlay and restores focus, and teardown releases roots/listeners/timers. Missing finite layout positions produce a visible degraded-layout message and readable stacked cards.

Inline `options` and `callbacks` objects are safe. A host render that reallocates them keeps an open details overlay, its restorable focus, and any dragged node positions, and the newest callback closures still receive events. Replace `graph` only when the data itself changes, because new node membership intentionally refits the viewport.

For a server-rendered shell, `mountRadiusGraph(element, props)` mounts this same component and returns `update(props): boolean` and idempotent `unmount()`. It is a compatibility boundary, not a separate renderer. Canvas keeps SDK interaction, local HTTP, source-opening fallback, worktree context, and workflow orchestration in `packages/adapter-canvas`.

## Packaging and provenance

The package exports JavaScript and declarations, `styles.css`, and a `presentation` subpath for typed graph presentation helpers. React and ReactDOM remain peers. Canvas bundles shared source into its existing self-contained browser artifact, ultimately `.artifacts/radius/com.github.copilot/extensions/radius/extension.mjs`; no package source is downloaded at runtime. Library release/version handling is separate from Copilot plugin discovery and release selection. No public registry publication is part of this implementation.

The renderer and its existing pure/browser scenarios were extracted from `ai-extensions` at `172782e`. The old Canvas renderer, layout, details, legend, model, and graph-specific stylesheet ownership were removed rather than copied into a second implementation. Canvas compatibility files only forward shared exports.

The design inputs are `docs/design/2026-09-radius-backstage-plugin.md` and `docs/design/2026-09-dashboard-plugin-test-plan.md` from dashboard commit `fd90d938267ceab5935b037bc7dd1ff59831e8b5`. The live normalization implementation and local fixtures are independently authored from those contracts. Dashboard implementation/fixture code was not copied because its package/repository license discrepancy remains unresolved.

## Qualification gates

Local package and component checks cannot substitute for the required dashboard-host gate. At the pinned dashboard revision, phases 0 and 3 are complete, phases 1 and 2 are in progress, and phase 4 onward has not started. GU-01 through GU-10 Tier A fixtures/invariants exist; that is not a frozen regression baseline.

The dashboard-owned CP-01 through CP-05 candidate pin/install/external-host seam, GU-20 real-renderer/stylesheet-negative journeys, GU-21 through GU-24 records/manifest, and Tier B real-renderer journeys remain prerequisites. Tests in this fork must use the exact packed candidate JS/declarations/CSS and transitive core resolution with matching React 18 and React 19 hosts, but even passing isolated checks cannot discharge those absent consumer gates.

The implementation must not be described as fully dashboard-regression-tested or ready for stable merge/publication until those prerequisites and mandatory consumer CI are available and pass. Do not upgrade the dashboard to React 19 or migrate React Flow merely to make an isolated candidate pass.
