// Browser component layer (P1-A, QR-01): the graph mounted in a real DOM.
//
// Pure presentation rules stay in the node-environment suite. Everything here
// mounts the canonical React tree with real React Flow, layout and browser input.

import { describe, it, expect, afterEach, vi } from "vitest";
import dagre from "dagre";
import { page } from "vitest/browser";
import { screen, waitFor, within } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { createElement as h, useState } from "react";
import { createRoot } from "react-dom/client";
import { normalizeLiveGraph } from "@radius-project/core/graph";
import { RadiusGraph } from "./graph.js";
import { buildGraph, resolveGraphSettings } from "./build.js";
import { mountRadiusGraph } from "./mount.js";
import type { GraphResource } from "./model.js";
import type { ReactElement } from "react";
import type { RadiusGraphProps } from "./graph.js";
import "./styles.css";

const RESOURCES = [
  {
    id: "app/web",
    name: "web",
    type: "Radius.Compute/containers",
    codeReference: "src/web.ts#L4",
    connections: [{ id: "app/db" }]
  },
  { id: "app/db", name: "db", type: "Radius.Data/sqlDatabases" }
];

interface Recorded {
  external: string[];
  local: Array<[string, number, string]>;
  toggled: string[];
  opened: string[];
  reloads: number;
}

interface Mounted {
  graph: { update(resources: GraphResource[]): boolean; unmount(): void };
  host: HTMLElement;
  recorded: Recorded;
}

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

function mount(
  options: {
    localSource?: boolean;
    deployMode?: boolean;
    showLegend?: boolean;
    diffMode?: boolean;
    baseBranch?: string;
    workspaceBranch?: string;
    resources?: GraphResource[];
  } = {}
): Mounted {
  const settings = resolveGraphSettings({
    localSource: options.localSource ?? true,
    deployMode: options.deployMode,
    showLegend: options.showLegend,
    diffMode: options.diffMode,
    baseBranch: options.baseBranch,
    workspaceBranch: options.workspaceBranch,
    repoUrl: "https://github.test/o/r",
    branch: "feature-branch"
  });
  const host = document.createElement("div");
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  const recorded: Recorded = {
    external: [],
    local: [],
    toggled: [],
    opened: [],
    reloads: 0
  };
  const kind =
    options.diffMode ? "diff"
    : options.deployMode ? "deployed-projection"
    : "modeled";
  const props: RadiusGraphProps = {
    graph: { kind, resources: options.resources ?? RESOURCES },
    options: settings,
    callbacks: {
      onOpenExternal: (url) => recorded.external.push(url),
      onOpenSource: ({ path, line, fallbackUrl }) =>
        recorded.local.push([path, line, fallbackUrl]),
      onDetails: (data) => recorded.toggled.push(`${data.id}:card`),
      onSelect: (data) => recorded.opened.push(data.id),
      onRetry: () => {
        recorded.reloads++;
      }
    }
  };
  const root = mountRadiusGraph(host, props);
  const graph = {
    update: (resources: GraphResource[]) =>
      root.update({ ...props, graph: { kind, resources } }),
    unmount: () => root.unmount()
  };
  disposers.push(() => {
    graph.unmount();
    host.remove();
  });
  return { graph, host, recorded };
}

describe("public host-neutral React API", () => {
  afterEach(() => vi.restoreAllMocks());
  function host() {
    const element = document.createElement("div");
    element.style.width = "900px";
    element.style.height = "600px";
    document.body.appendChild(element);
    const root = createRoot(element);
    disposers.push(() => {
      root.unmount();
      element.remove();
    });
    return { root, element };
  }

  const prefix = "/planes/radius/local/resourceGroups/example/providers/";
  const context = {
    connectionId: "first",
    plane: { type: "radius", name: "local" },
    applicationId: prefix + "Radius.Core/applications/app"
  };
  const resource = {
    id: prefix + "Radius.Core/containers/live-web",
    name: "live-web",
    type: "Radius.Core/containers",
    provisioningState: "CustomPending"
  };

  it("rejects a non-DOM mount target", () => {
    expect(() =>
      mountRadiusGraph({}, { graph: { kind: "modeled", resources: [] } })
    ).toThrow(TypeError);
  });

  it("surfaces rendering failures, supports host retry and recovers on new graph identity", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, element } = host();
    const failed = {
      kind: "live" as const,
      context: { ...context, applicationId: "invalid" },
      resources: [],
      warnings: []
    };
    root.render(h(RadiusGraph, { graph: failed }));
    expect(await within(element).findByRole("alert")).toBeTruthy();
    expect(
      within(element).queryByRole("button", { name: "Reload graph" })
    ).toBeNull();
    let retried = false;
    root.render(
      h(RadiusGraph, {
        graph: failed,
        callbacks: {
          onRetry: () => {
            retried = true;
            root.render(
              h(RadiusGraph, {
                graph: {
                  kind: "modeled",
                  resources: [{ id: "fixed", name: "fixed" }]
                }
              })
            );
          }
        }
      })
    );
    await userEvent.click(
      await within(element).findByRole("button", { name: "Reload graph" })
    );
    expect(retried).toBe(true);
    await within(element).findByRole("group", { name: "fixed" });
    expect(within(element).queryByRole("alert")).toBeNull();
  });

  it("keeps cards usable with a visible warning when the single layout engine fails", async () => {
    vi.spyOn(dagre, "layout").mockImplementation(() => {
      throw new Error("layout failed");
    });
    const { root, element } = host();
    root.render(
      h(RadiusGraph, {
        graph: {
          kind: "planned",
          resources: [
            { id: "web", name: "web" },
            { id: "db", name: "db" }
          ]
        },
        options: { showLegend: true }
      })
    );
    await within(element).findByRole("group", { name: "web" });
    expect(within(element).getByRole("status").textContent).toContain(
      "Layout failed"
    );
    await page.getByRole("group", { name: "db", exact: true }).click();
    expect(
      element.querySelector("[data-radius-details]")?.getAttribute("style")
    ).not.toMatch(/display:\s*none/);
  });

  it("resets details when switching live connections even if resource IDs match", async () => {
    const { root, element } = host();
    root.render(
      h(RadiusGraph, {
        graph: normalizeLiveGraph({ resources: [resource] }, context)
      })
    );
    await userEvent.click(
      await within(element).findByRole("button", { name: "Show details" })
    );
    root.render(
      h(RadiusGraph, {
        graph: normalizeLiveGraph(
          {
            resources: [{ ...resource, provisioningState: "Refreshed" }]
          },
          context
        )
      })
    );
    await within(element).findByText("Provisioning status: Refreshed");
    expect(
      element.querySelector("[data-radius-details]")?.getAttribute("style")
    ).not.toMatch(/display:\s*none/);
    root.render(
      h(RadiusGraph, {
        graph: normalizeLiveGraph(
          { resources: [resource] },
          { ...context, connectionId: "second" }
        )
      })
    );
    await waitFor(() =>
      expect(
        element.querySelector("[data-radius-details]")?.getAttribute("style")
      ).toMatch(/display:\s*none/)
    );
  });

  it("renders workflow status legends and preserves explicit host styles", async () => {
    const { root, element } = host();
    root.render(
      h(RadiusGraph, {
        graph: {
          kind: "deployed-projection",
          resources: [{ id: "web", name: "web", deployStatus: "failed" }]
        },
        options: { showLegend: true },
        style: { colorScheme: "dark" },
        className: "host-class",
        ariaLabel: "Host graph"
      })
    );
    await within(element).findByRole("group", { name: "web" });
    expect(element.querySelector(".legend")?.textContent).toContain("Failed");
    expect(
      within(element).getByRole("region", { name: "Host graph" }).style
        .colorScheme
    ).toBe("dark");
    expect(element.querySelector(".host-class")).not.toBeNull();
  });

  it("renders live UCP without hashes, source controls or synthesized deployment success", async () => {
    const { root, element } = host();
    const selected: string[] = [];
    const navigated: string[] = [];
    root.render(
      h(RadiusGraph, {
        graph: normalizeLiveGraph({ resources: [resource] }, context),
        theme: { background: "#101010", text: "#ffffff", colorScheme: "dark" },
        callbacks: {
          onSelect: (node) => selected.push(node.id),
          onNavigate: (node) => navigated.push(node.id)
        }
      })
    );
    const node = await within(element).findByRole("group", {
      name: "live-web"
    });
    expect(
      within(node).getByLabelText("Provisioning status: CustomPending")
    ).toBeTruthy();
    expect(within(node).queryByText("View source code")).toBeNull();
    expect(within(node).queryByAltText("Deployed")).toBeNull();
    await userEvent.click(
      within(node).getByRole("button", { name: "Show details" })
    );
    expect(selected).toEqual([resource.id]);
    expect(
      await within(element).findByText("Provisioning status: CustomPending")
    ).toBeTruthy();
    await userEvent.click(
      within(node).getByRole("button", { name: "Open live-web" })
    );
    expect(navigated).toEqual([resource.id]);
    expect(
      element.querySelector(".radius-graph")?.getAttribute("style")
    ).toContain("color-scheme: dark");
  });

  it("renders explicit empty and partial states and updates without replacing the React root", async () => {
    const { root, element } = host();
    root.render(
      h(RadiusGraph, { graph: normalizeLiveGraph({ resources: [] }, context) })
    );
    expect(await within(element).findByRole("status")).toHaveProperty(
      "textContent",
      "No resources in this application."
    );
    const graph = normalizeLiveGraph(
      {
        resources: [
          {
            ...resource,
            connections: [{ id: "missing" }]
          }
        ]
      },
      context
    );
    root.render(h(RadiusGraph, { graph }));
    await within(element).findByRole("group", { name: "live-web" });
    expect(within(element).getByRole("status").textContent).toContain(
      "missing"
    );
    root.render(h(RadiusGraph, { graph: { kind: "modeled", resources: [] } }));
    expect(
      await within(element).findByText("No resources in this application.")
    ).toBeTruthy();
  });

  it("isolates simultaneous graphs, uses unique detail IDs and restores keyboard focus", async () => {
    const first = host();
    const second = host();
    for (const instance of [first, second]) {
      instance.element.style.width = "400px";
      instance.element.style.height = "450px";
      instance.element.style.display = "inline-block";
    }
    const graph = normalizeLiveGraph({ resources: [resource] }, context);
    first.root.render(h(RadiusGraph, { graph }));
    second.root.render(h(RadiusGraph, { graph }));
    const firstButton = await within(first.element).findByRole("button", {
      name: "Show details"
    });
    const secondButton = await within(second.element).findByRole("button", {
      name: "Show details"
    });
    firstButton.focus();
    await userEvent.keyboard("{Enter}");
    const firstPanel = first.element.querySelector("[data-radius-details]");
    const secondPanel = second.element.querySelector("[data-radius-details]");
    expect(firstPanel?.id).not.toBe(secondPanel?.id);
    expect(firstPanel?.getAttribute("style")).not.toMatch(/display:\s*none/);
    expect(secondPanel?.getAttribute("style")).toMatch(/display:\s*none/);
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(firstButton);
    expect(secondButton).toBeTruthy();
  });

  it("keeps details open across host renders that pass inline options and callbacks", async () => {
    const { root, element } = host();
    // The graph object is the one reference the README asks hosts to keep
    // stable. Options and callbacks are inlined the way its example shows.
    const graph: RadiusGraphProps["graph"] = {
      kind: "modeled",
      resources: RESOURCES
    };
    const sourced: string[] = [];
    const control: { bump?: () => void } = {};
    function HostApp(): ReactElement {
      const [tick, setTick] = useState(0);
      control.bump = () => setTick((value) => value + 1);
      return h(RadiusGraph, {
        graph,
        options: { localSource: true },
        callbacks: {
          onOpenSource: ({ path }) => sourced.push(`${tick}:${path}`),
          onOpenExternal: (url) => sourced.push(`${tick}:${url}`),
          onSelect: () => sourced.push(`${tick}:select`),
          onDetails: () => sourced.push(`${tick}:details`),
          onNavigate: () => sourced.push(`${tick}:navigate`),
          onRetry: () => sourced.push(`${tick}:retry`)
        }
      });
    }
    root.render(h(HostApp));

    const web = await within(element).findByRole("group", { name: "web" });
    await userEvent.click(
      within(web).getByRole("button", { name: "Show details" })
    );
    const panel = element.querySelector("[data-radius-details]");
    expect(panel?.getAttribute("style")).not.toMatch(/display:\s*none/);
    expect(sourced).toEqual(["0:select", "0:details"]);

    control.bump?.();
    await userEvent.click(
      within(web).getByRole("link", { name: /View source code/ })
    );
    // Proves the host really re-rendered and that the stable facade forwards to
    // the newest closure rather than one captured when the panel was created.
    expect(sourced.at(-1)).toBe("1:src/web.ts");
    // The panel survived that render instead of being destroyed and rebuilt,
    // which would have dropped the open node and the focus to restore.
    expect(element.querySelector("[data-radius-details]")).toBe(panel);
    expect(panel?.getAttribute("style")).not.toMatch(/display:\s*none/);
  });

  it("exposes the documented root and viewport styling contract", async () => {
    const { root, element } = host();
    root.render(
      h(RadiusGraph, { graph: { kind: "modeled", resources: RESOURCES } })
    );
    await within(element).findByRole("group", { name: "web" });
    const surface = element.querySelector<HTMLElement>(".radius-graph");
    // README documents exactly these two classes as a host styling contract,
    // so a host may size the drawing area without reaching into internals.
    const viewport = surface?.querySelector<HTMLElement>(
      ":scope > .radius-graph__viewport"
    );
    expect(viewport).toBeTruthy();
    expect(viewport?.querySelector(".react-flow")).toBeTruthy();
    // The component contributes no height of its own: it fills the 900x600
    // box this host gave it, which is what lets a host own graph layout.
    const box = viewport?.getBoundingClientRect();
    expect(box?.width).toBeCloseTo(900, 1);
    expect(box?.height).toBeCloseTo(600, 1);
  });

  it("does not expose details controls when the host disables that capability", async () => {
    const { root, element } = host();
    root.render(
      h(RadiusGraph, {
        graph: normalizeLiveGraph({ resources: [resource] }, context),
        options: { enablePopup: false }
      })
    );
    await within(element).findByRole("group", { name: "live-web" });
    expect(
      within(element).queryByRole("button", { name: "Show details" })
    ).toBeNull();
    expect(element.querySelector("[data-radius-details]")).toBeNull();
    await page.getByRole("group", { name: "live-web", exact: true }).click();
    expect(element.querySelector("[data-radius-details]")).toBeNull();
  });

  it("opens a local source without requiring a remote repository URL", async () => {
    const { root, element } = host();
    const onOpenSource = vi.fn();
    root.render(
      h(RadiusGraph, {
        graph: { kind: "modeled", resources: RESOURCES },
        options: { localSource: true },
        callbacks: { onOpenSource }
      })
    );
    const web = await within(element).findByRole("group", { name: "web" });
    const source = within(web).getByRole("link", {
      name: /View source code/
    });
    expect(source.getAttribute("href")).toBe("#");
    const previousLocation = window.location.href;
    await userEvent.click(source);
    expect(onOpenSource).toHaveBeenCalledExactlyOnceWith({
      path: "src/web.ts",
      line: 4,
      fallbackUrl: ""
    });
    expect(window.location.href).toBe(previousLocation);
  });

  it("retains a native remote source fallback when the host has no local opening capability", async () => {
    const { root, element } = host();
    root.render(
      h(RadiusGraph, {
        graph: {
          kind: "modeled",
          resources: [
            { id: "source", name: "source", codeReference: "src/web.ts#L4" }
          ]
        },
        options: {
          repoUrl: "https://github.com/example/app",
          branch: "main",
          localSource: true
        }
      })
    );
    const source = await within(element).findByRole("link", {
      name: /View source code/
    });
    expect(source.getAttribute("href")).toBe(
      "https://github.com/example/app/blob/main/src/web.ts#L4"
    );
    expect(source.getAttribute("target")).toBe("_blank");
    source.addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(source);
    expect(
      element.querySelector("[data-radius-details]")?.getAttribute("style")
    ).toMatch(/display:\s*none/);
  });

  // The panel used to be raw DOM appended into the drawing area with one
  // delegated listener. These cover the same behaviour now that React owns it.
  async function openDetails(
    element: HTMLElement,
    name: string
  ): Promise<HTMLElement> {
    const owner = await within(element).findByRole("group", { name });
    await userEvent.click(
      within(owner).getByRole("button", { name: "Show details" })
    );
    const panel = element.querySelector("[data-radius-details]");
    if (!(panel instanceof HTMLElement))
      throw new Error("missing details panel");
    return panel;
  }

  it("stays open inside itself, re-anchors to another card and closes on the pane", async () => {
    const { root, element } = host();
    root.render(
      h(RadiusGraph, {
        graph: { kind: "modeled", resources: RESOURCES },
        options: { localSource: true },
        callbacks: { onOpenSource: () => {} }
      })
    );
    const panel = await openDetails(element, "web");
    const anchoredToWeb = panel.style.top;
    expect(panel.style.display).not.toBe("none");

    await userEvent.click(
      within(panel).getByRole("link", { name: /View source code/ })
    );
    expect(panel.style.display).not.toBe("none");

    // A different card re-anchors the one panel rather than opening a second.
    // A plain click, because user-event's synthetic mousedown reaches React
    // Flow's d3 drag handlers, which need a real pointer sequence.
    (await within(element).findByRole("group", { name: "db" })).click();
    await waitFor(() => expect(panel.style.top).not.toBe(anchoredToWeb));
    expect(element.querySelectorAll("[data-radius-details]")).toHaveLength(1);
    expect(panel.style.display).not.toBe("none");

    const pane = element.querySelector(".react-flow__pane");
    if (!(pane instanceof HTMLElement)) throw new Error("missing graph pane");
    pane.click();
    await waitFor(() => expect(panel.style.display).toBe("none"));
  });

  it("routes a panel destination through the host instead of navigating", async () => {
    const { root, element } = host();
    const external: string[] = [];
    root.render(
      h(RadiusGraph, {
        graph: {
          kind: "modeled",
          resources: [
            { id: "web", name: "web", codeReference: "src/web.ts#L4" }
          ]
        },
        options: { repoUrl: "https://github.com/example/app", branch: "main" },
        callbacks: { onOpenExternal: (url) => external.push(url) }
      })
    );
    const panel = await openDetails(element, "web");
    const here = window.location.href;
    await userEvent.click(
      within(panel).getByRole("link", { name: /View source code/ })
    );
    expect(external).toEqual([
      "https://github.com/example/app/blob/main/src/web.ts#L4"
    ]);
    expect(window.location.href).toBe(here);
  });

  it("leaves panel rows natively navigable for a host with no open capability", async () => {
    const { root, element } = host();
    root.render(
      h(RadiusGraph, {
        graph: {
          kind: "modeled",
          resources: [
            { id: "web", name: "web", codeReference: "src/web.ts#L4" }
          ]
        },
        options: {
          repoUrl: "https://github.com/example/app",
          branch: "main",
          localSource: true
        }
      })
    );
    const panel = await openDetails(element, "web");
    const rows = within(panel).getAllByRole("link");
    // Both rows keep a real href, and nothing cancels the default action.
    expect(rows[0].getAttribute("href")).toBe(
      "https://github.com/example/app/blob/main/src/web.ts#L4"
    );
    for (const row of rows) {
      let prevented = true;
      row.addEventListener("click", (event) => {
        prevented = event.defaultPrevented;
        event.preventDefault();
      });
      await userEvent.click(row);
      expect(prevented).toBe(false);
    }
    expect(panel.style.display).not.toBe("none");

    // The same holds for a remote graph, whose rows navigate outward.
    root.render(
      h(RadiusGraph, {
        graph: {
          kind: "modeled",
          resources: [
            { id: "api", name: "api", codeReference: "src/api.ts#L4" }
          ]
        },
        options: { repoUrl: "https://github.com/example/app", branch: "main" }
      })
    );
    const remote = await openDetails(element, "api");
    const external = within(remote).getByRole("link", {
      name: /View source code/
    });
    let externalPrevented = true;
    external.addEventListener("click", (event) => {
      externalPrevented = event.defaultPrevented;
      event.preventDefault();
    });
    await userEvent.click(external);
    expect(externalPrevented).toBe(false);
  });

  it("renders a failure message as text and says when a node has no links", async () => {
    const { root, element } = host();
    const message = "<script>alert(1)</script> quota exceeded";
    root.render(
      h(RadiusGraph, {
        graph: {
          kind: "deployed-projection",
          resources: [
            {
              id: "web",
              name: "web",
              deployStatus: "failed",
              deployMessage: message
            }
          ]
        }
      })
    );
    const failure = await openDetails(element, "web");
    expect(failure.querySelector("script")).toBeNull();
    expect(failure.textContent).toContain(message);
    expect(failure.firstElementChild?.getAttribute("style")).toContain(
      "--rad-danger"
    );

    // A message that is not a failure reads as ordinary secondary text.
    root.render(
      h(RadiusGraph, {
        graph: {
          kind: "deployed-projection",
          resources: [
            {
              id: "api",
              name: "api",
              deployStatus: "succeeded",
              deployMessage: "Deployment complete"
            }
          ]
        }
      })
    );
    const succeeded = await openDetails(element, "api");
    expect(succeeded.firstElementChild?.getAttribute("style")).toContain(
      "--rad-text-secondary"
    );

    root.render(
      h(RadiusGraph, {
        graph: { kind: "modeled", resources: [{ id: "bare", name: "bare" }] }
      })
    );
    const empty = await openDetails(element, "bare");
    expect(empty.textContent).toBe("No links available.");
  });

  it("shows an unusable destination inert and a portal row without its URL", async () => {
    const { root, element } = host();
    root.render(
      h(RadiusGraph, {
        graph: {
          kind: "modeled",
          resources: [
            {
              id: "web",
              name: "web",
              codeReference: "src/web.ts#L4",
              portalUrl: "https://portal.test/resource"
            }
          ]
        },
        options: { repoUrl: "javascript:alert(1)", branch: "main" }
      })
    );
    const panel = await openDetails(element, "web");
    expect(
      within(panel).getByText("View source code").closest("[aria-disabled]")
    ).toBeTruthy();
    expect(
      within(panel).queryByRole("link", { name: /View source code/ })
    ).toBeNull();
    const portal = within(panel).getByRole("link", { name: /View in portal/ });
    expect(portal.getAttribute("href")).toBe("https://portal.test/resource");
    // A portal row shows no subtitle, so the raw URL never appears as text.
    expect(panel.textContent).not.toContain("https://portal.test/resource");
  });

  it("re-anchors an open panel when a relayout moves its card and closes with the node", async () => {
    const { root, element } = host();
    const unconnected = [
      { id: "app/web", name: "web" },
      { id: "app/db", name: "db" }
    ];
    root.render(
      h(RadiusGraph, { graph: { kind: "modeled", resources: unconnected } })
    );
    const panel = await openDetails(element, "db");
    const before = panel.style.top;

    root.render(
      h(RadiusGraph, {
        graph: {
          kind: "modeled",
          resources: [
            { ...unconnected[0], connections: [{ id: "app/db" }] },
            unconnected[1]
          ]
        }
      })
    );
    // Same node identities, so the panel stays open and follows its card down
    // to the rank the edge put it on.
    await waitFor(() => expect(panel.style.top).not.toBe(before));
    expect(panel.style.display).not.toBe("none");

    root.render(
      h(RadiusGraph, {
        graph: { kind: "modeled", resources: [unconnected[0]] }
      })
    );
    await waitFor(() => expect(panel.style.display).toBe("none"));
  });
});
async function card(name: string): Promise<HTMLElement> {
  return screen.findByRole("group", { name });
}

function rgbChannels(color: string): number[] {
  return color.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
}

function maximumChannelDelta(left: string, right: string): number {
  const leftChannels = rgbChannels(left);
  const rightChannels = rgbChannels(right);
  if (leftChannels.length !== 3 || rightChannels.length !== 3) {
    throw new Error(`expected RGB colors, received ${left} and ${right}`);
  }
  return Math.max(
    ...leftChannels.map((channel, index) =>
      Math.abs(channel - rightChannels[index])
    )
  );
}

async function waitForStableTransform(viewport: HTMLElement): Promise<string> {
  let previous = "";
  let stableChecks = 0;
  await waitFor(() => {
    const current = viewport.style.transform;
    if (current === previous && current !== "") stableChecks++;
    else stableChecks = 0;
    previous = current;
    expect(stableChecks).toBeGreaterThanOrEqual(2);
  });
  return viewport.style.transform;
}

describe("graph view in a real browser", () => {
  it("routes a details-panel source link through the same host callback as the card", async () => {
    const { host, recorded } = mount({ localSource: true });
    const web = await card("web");
    await userEvent.click(
      within(web).getByRole("button", { name: "Show details" })
    );
    const panel = host.querySelector("[data-radius-details]");
    if (!(panel instanceof HTMLElement))
      throw new Error("missing details panel");
    await userEvent.click(
      within(panel).getByRole("link", { name: "View source code" })
    );
    expect(recorded.local).toHaveLength(1);
    expect(recorded.local[0][0]).toContain("src/");
  });

  it("does not open details when a deployed portal link is activated", async () => {
    const { recorded } = mount({
      deployMode: true,
      resources: [
        {
          id: "portal",
          name: "portal",
          portalUrl: "https://portal.azure.com/#test"
        }
      ]
    });
    const node = await card("portal");
    const link = within(node).getByRole("link", {
      name: "Open portal in Azure Portal"
    });
    link.addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(link);
    expect(recorded.opened).toEqual([]);
  });
  it("renders changed diff states with distinct fills and borders", async () => {
    mount({
      diffMode: true,
      resources: [
        { id: "added", name: "added", diffStatus: "added" },
        { id: "removed", name: "removed", diffStatus: "removed" },
        { id: "modified", name: "modified", diffStatus: "modified" },
        { id: "unchanged", name: "unchanged", diffStatus: "unchanged" }
      ]
    });

    const styles = await Promise.all(
      ["added", "removed", "modified", "unchanged"].map(async (name) =>
        getComputedStyle(await card(name))
      )
    );
    const changed = styles.slice(0, 3);

    expect(
      new Set(changed.map(({ backgroundColor }) => backgroundColor))
    ).toHaveLength(3);
    expect(new Set(changed.map(({ borderColor }) => borderColor))).toHaveLength(
      3
    );
    for (let left = 0; left < changed.length; left += 1) {
      for (let right = left + 1; right < changed.length; right += 1) {
        expect(
          maximumChannelDelta(
            changed[left].backgroundColor,
            changed[right].backgroundColor
          )
        ).toBeGreaterThanOrEqual(4);
      }
    }
    for (const changedStyle of changed) {
      expect(changedStyle.backgroundColor).not.toBe(styles[3].backgroundColor);
      expect(changedStyle.borderColor).not.toBe(styles[3].borderColor);
    }
  });

  it("renders a card per resource with the real libraries", async () => {
    mount();

    const web = await card("web");
    const db = await card("db");

    expect(within(web).getByTitle("Compute/containers")).toBeTruthy();
    expect(web.getAttribute("data-node-id")).toBe("app/web");
    expect(db.getAttribute("data-node-id")).toBe("app/db");
    // Both cards occupy real space, which is the check a node-environment test
    // cannot make: React Flow only paints once it has measured its container.
    expect(web.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(db.getBoundingClientRect().height).toBeGreaterThan(0);
  });

  it("keeps long resource names inside the card", async () => {
    const name = "recommendationservice-".repeat(8);
    mount({
      deployMode: true,
      resources: [
        {
          id: "app/recommendation",
          name,
          type: "Radius.Compute/containers",
          deployStatus: "success"
        }
      ]
    });

    const recommendation = await card(name);
    const title = within(recommendation).getByTitle(name);
    const badge = within(recommendation).getByAltText("Deployed");
    const titleBounds = title.getBoundingClientRect();
    const cardBounds = recommendation.getBoundingClientRect();
    const badgeBounds = badge.getBoundingClientRect();
    const styles = getComputedStyle(title);

    expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
    expect(styles.overflow).toBe("hidden");
    expect(styles.textOverflow).toBe("ellipsis");
    expect(titleBounds.right).toBeLessThanOrEqual(cardBounds.right);
    expect(titleBounds.right).toBeLessThanOrEqual(badgeBounds.left);
  });

  it("renders the deployed parent with its representative concrete root type", async () => {
    const { recorded } = mount({
      deployMode: true,
      resources: [
        {
          id: "mysql",
          name: "mysql",
          type: "Radius.Data/mySqlDatabases",
          deployStatus: "success",
          outputResources: [
            { id: "lock", type: "Microsoft.Authorization/locks" },
            {
              id: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.DBforMySQL/flexibleServers/server",
              type: "Microsoft.DBforMySQL/flexibleServers",
              portalUrl: "https://portal.azure.com/#@tenant/resource/server"
            },
            {
              id: "database",
              type: "Microsoft.DBforMySQL/flexibleServers/databases"
            }
          ]
        }
      ]
    });

    const mysql = await card("mysql");
    expect(
      within(mysql).getByTitle("Microsoft.DBforMySQL/flexibleServers")
    ).toBeTruthy();
    expect(mysql.getAttribute("data-node-id")).toBe("mysql");

    const portal = mysql.querySelector("a.rad-node__portal");
    if (!(portal instanceof HTMLAnchorElement)) {
      throw new Error("deployed node has no native portal link");
    }
    expect(portal.getAttribute("aria-label")).toBe(
      "Open mysql in Azure Portal"
    );
    expect(portal.getAttribute("href")).toBe(
      "https://portal.azure.com/#@tenant/resource/server"
    );
    expect(portal.getAttribute("target")).toBe("_blank");
    expect(recorded.opened).toEqual([]);
  });

  it("places connected nodes on separate rows using the real dagre layout", async () => {
    mount();

    const web = await card("web");
    const db = await card("db");

    // buildGraph declares web -> db, and the layout is configured top to bottom,
    // so the real engine must put the target below the source.
    expect(db.getBoundingClientRect().top).toBeGreaterThan(
      web.getBoundingClientRect().bottom
    );
  });

  it("exposes the details control by accessible name and activates it from the keyboard", async () => {
    const { recorded } = mount();
    const web = await card("web");
    const details = await within(web).findByRole("button", {
      name: "Show details"
    });

    details.focus();
    expect(document.activeElement).toBe(details);

    await userEvent.keyboard("{Enter}");
    expect(recorded.toggled).toEqual(["app/web:card"]);

    await userEvent.keyboard("[Space]");
    expect(recorded.toggled).toEqual(["app/web:card", "app/web:card"]);
    // The control keeps focus, so the next key still reaches the same card.
    expect(document.activeElement).toBe(details);
  });

  it("opens the workspace file from the source link without following the href", async () => {
    const { recorded } = mount({ localSource: true });
    const web = await card("web");
    const link = await within(web).findByRole("link", {
      name: /View source code/
    });

    await userEvent.click(link);

    expect(recorded.local).toHaveLength(1);
    expect(recorded.local[0][0]).toBe("src/web.ts");
    expect(recorded.local[0][1]).toBe(4);
    // A real navigation would have torn the document down.
    expect(document.body.contains(link)).toBe(true);
    // The card's own click handler must not also fire for a source click.
    expect(recorded.opened).toEqual([]);
  });

  it("opens a remote source link through the host without navigating the webview", async () => {
    const { recorded } = mount({ localSource: false });
    const web = await card("web");
    const link = await within(web).findByRole("link", {
      name: /View source code/
    });

    await userEvent.click(link);

    expect(recorded.external).toEqual([
      "https://github.test/o/r/blob/feature-branch/src/web.ts#L4"
    ]);
    expect(document.body.contains(link)).toBe(true);
    expect(recorded.opened).toEqual([]);
  });

  it("opens an exact GitHub source URL externally from a worktree graph", async () => {
    const sourceUrl =
      "https://github.com/acme/widgets/blob/release/src/web.ts#L4";
    const { recorded } = mount({
      localSource: true,
      resources: [
        {
          ...RESOURCES[0],
          codeReference: sourceUrl
        }
      ]
    });
    const web = await card("web");
    const link = await within(web).findByRole("link", {
      name: /View source code/
    });

    await userEvent.click(link);

    expect(recorded.external).toEqual([sourceUrl]);
    expect(recorded.local).toEqual([]);
    expect(document.body.contains(link)).toBe(true);
  });

  it("routes each diff node's source link by the branch that node lives on", async () => {
    // The worktree can only have one of the two compared branches checked out,
    // so a head-branch node must open locally while a removed node, whose file
    // lives on the base branch, must still go out to the host.
    const { recorded } = mount({
      diffMode: true,
      baseBranch: "main",
      workspaceBranch: "feature-branch",
      resources: [
        {
          id: "app/web",
          name: "web",
          type: "Radius.Compute/containers",
          codeReference: "src/web.ts#L4",
          diffStatus: "added"
        },
        {
          id: "app/old-worker",
          name: "old-worker",
          type: "Radius.Compute/containers",
          codeReference: "src/worker.ts#L9",
          diffStatus: "removed"
        }
      ]
    });

    const web = await card("web");
    await userEvent.click(
      await within(web).findByRole("link", { name: /View source code/ })
    );

    expect(recorded.local).toEqual([["src/web.ts", 4, expect.any(String)]]);
    expect(recorded.external).toEqual([]);

    const worker = await card("old-worker");
    await userEvent.click(
      await within(worker).findByRole("link", { name: /View source code/ })
    );

    expect(recorded.local).toHaveLength(1);
    expect(recorded.external).toEqual([
      "https://github.test/o/r/blob/main/src/worker.ts#L9"
    ]);
  });

  it("keeps every diff node remote when the worktree is on neither compared branch", async () => {
    const { recorded } = mount({
      diffMode: true,
      baseBranch: "main",
      workspaceBranch: "unrelated-branch",
      resources: [
        {
          id: "app/web",
          name: "web",
          type: "Radius.Compute/containers",
          codeReference: "src/web.ts#L4",
          diffStatus: "added"
        }
      ]
    });

    const web = await card("web");
    await userEvent.click(
      await within(web).findByRole("link", { name: /View source code/ })
    );

    expect(recorded.local).toEqual([]);
    expect(recorded.external).toEqual([
      "https://github.test/o/r/blob/feature-branch/src/web.ts#L4"
    ]);
  });

  it("marks the source row disabled when the node has no reference", async () => {
    mount({ localSource: true });
    const db = await card("db");

    const row = await within(db).findByRole("button", {
      name: /View source code/
    });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(within(db).queryByRole("link")).toBeNull();
  });

  it("reaches every card by keyboard alone in document order", async () => {
    mount();
    await card("web");

    document.body.focus();
    const reached: string[] = [];
    for (let step = 0; step < 12; step += 1) {
      await userEvent.tab();
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) break;
      const owner = active.closest(".rad-node");
      const label =
        active.getAttribute("aria-label") ?? active.textContent?.trim() ?? "";
      if (owner instanceof HTMLElement) {
        reached.push(`${owner.getAttribute("data-node-id")}:${label}`);
      }
      if (reached.length >= 2 && reached[0] === reached.at(-1)) break;
    }

    // Every card's details control is reachable without a pointer.
    expect(reached).toContain("app/web:Show details");
    expect(reached).toContain("app/db:Show details");
  });

  it("re-renders through the real root when the controller pushes new data", async () => {
    const { graph } = mount();
    await card("web");

    const settings = resolveGraphSettings({ localSource: true });
    const next = buildGraph(settings, [
      { id: "app/cache", name: "cache", type: "Radius.Data/redisCaches" }
    ]);
    expect(graph.update(next.resources)).toBe(true);

    await waitFor(() => expect(screen.queryByText("web")).toBeNull());
    expect(
      screen.getByText("cache", { selector: ".rad-node__title" })
    ).toBeTruthy();
  });

  it("preserves control hit areas without resizing host buttons or the fill-container viewport", async () => {
    const { host } = mount({ deployMode: true, showLegend: true });
    await card("web");
    const externalButton = document.createElement("button");
    externalButton.textContent = "Host action";
    externalButton.style.cssText =
      "box-sizing:border-box;width:26px;height:26px;padding:5px;border:0;";
    document.body.appendChild(externalButton);
    disposers.push(() => externalButton.remove());

    const controls = host.querySelectorAll(".react-flow__controls-button");
    expect(controls).toHaveLength(3);
    for (const control of controls) {
      expect(getComputedStyle(control).boxSizing).toBe("content-box");
      const box = control.getBoundingClientRect();
      expect(box.width).toBeCloseTo(36, 1);
      expect(box.height).toBeCloseTo(37, 1);
      const glyph = control.querySelector("svg");
      if (!glyph) throw new Error("Graph control has no glyph");
      expect(glyph.getBoundingClientRect().width).toBeCloseTo(12, 1);
      expect(glyph.getBoundingClientRect().height).toBeCloseTo(
        (12 * glyph.viewBox.baseVal.height) / glyph.viewBox.baseVal.width
      );
    }
    expect(externalButton.getBoundingClientRect()).toMatchObject({
      width: 26,
      height: 26
    });
    const viewport = host.querySelector(".radius-graph__viewport");
    expect(viewport?.getBoundingClientRect().bottom).toBe(
      host.getBoundingClientRect().bottom
    );
    expect(viewport?.getBoundingClientRect().height).toBeLessThan(600);
  });

  it("preserves a zoomed viewport when deployment data refreshes", async () => {
    const { graph, host } = mount({ deployMode: true });
    await card("web");
    const viewport = host.querySelector(".react-flow__viewport");
    const zoomOut = host.querySelector(".react-flow__controls-zoomout");
    if (
      !(viewport instanceof HTMLElement) ||
      !(zoomOut instanceof HTMLElement)
    ) {
      throw new Error("graph viewport controls did not render");
    }

    const fittedTransform = await waitForStableTransform(viewport);
    await userEvent.click(zoomOut);
    const zoomedTransform = await waitForStableTransform(viewport);
    // Guard against a vacuous assertion: the control must really move the
    // viewport, otherwise "unchanged after refresh" would prove nothing.
    expect(zoomedTransform).not.toBe(fittedTransform);

    const settings = resolveGraphSettings({
      localSource: true,
      deployMode: true
    });

    const next = buildGraph(
      settings,
      RESOURCES.map((resource) => ({
        ...resource,
        deployStatus: "success"
      }))
    );
    expect(graph.update(next.resources)).toBe(true);

    await screen.findAllByAltText("Deployed");
    expect(await waitForStableTransform(viewport)).toBe(zoomedTransform);
  });

  it("re-fits a zoomed viewport when the update changes which nodes exist", async () => {
    const { graph, host } = mount({ deployMode: true });
    await card("web");
    const viewport = host.querySelector(".react-flow__viewport");
    const zoomOut = host.querySelector(".react-flow__controls-zoomout");
    if (
      !(viewport instanceof HTMLElement) ||
      !(zoomOut instanceof HTMLElement)
    ) {
      throw new Error("graph viewport controls did not render");
    }

    const fittedTransform = await waitForStableTransform(viewport);
    await userEvent.click(zoomOut);
    const zoomedTransform = await waitForStableTransform(viewport);
    expect(zoomedTransform).not.toBe(fittedTransform);

    // Switching application or environment reuses the controller, so a wholly
    // different resource set arrives through update(). Keeping the old pan and
    // zoom could leave the new graph off screen entirely.
    const settings = resolveGraphSettings({
      localSource: true,
      deployMode: true
    });
    const next = buildGraph(settings, [
      { id: "other/api", name: "api", deployStatus: "success" },
      { id: "other/cache", name: "cache", deployStatus: "success" }
    ]);
    expect(graph.update(next.resources)).toBe(true);

    await card("api");
    expect(await waitForStableTransform(viewport)).not.toBe(zoomedTransform);
  });

  it("detaches the real root on unmount and stops answering updates", async () => {
    const { graph, host } = mount();
    await card("web");

    graph.unmount();

    await waitFor(() => expect(host.textContent).toBe(""));
    expect(graph.update([])).toBe(false);
    // A second teardown is harmless, which is what navigation relies on.
    expect(() => graph.unmount()).not.toThrow();
  });
});
