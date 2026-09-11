import { describe, expect, it } from "vitest";
import {
  asGraphController,
  createGraphSurface,
  GRAPH_LIBRARY_ERROR,
  GRAPH_LOADING_HTML,
  GRAPH_RENDER_ERROR,
  OPEN_SOURCE_PATH
} from "./surface.js";
import {
  createFakeBrowser,
  createFakeElement,
  flushPromises,
  jsonResponse
} from "../../../test/support/browser/fakes.js";
import { createRecordingMount } from "../../../test/support/browser/graph-mount.js";

function setup() {
  const browser = createFakeBrowser();
  const container = createFakeElement("graph-container");
  browser.document.add(container);
  const renderer = createRecordingMount();
  const surface = createGraphSurface(browser.context, () => renderer.mount);
  return { browser, container, renderer, surface };
}

describe("Canvas graph mounting boundary", () => {
  it("recognizes only complete controllers", () => {
    expect(asGraphController(null)).toBeNull();
    expect(asGraphController({ update() {} })).toBeNull();
    expect(asGraphController({ destroy() {} })).toBeNull();
    let destroyed = 0;
    const controller = asGraphController({
      update: () => null,
      destroy: () => {
        destroyed++;
      }
    });
    expect(controller?.update([])).toBeNull();
    controller?.destroy();
    expect(destroyed).toBe(1);
  });
  it.each([
    [{}, "modeled"],
    [{ plannedMode: true }, "planned"],
    [{ deployMode: true }, "deployed-projection"],
    [{ diffMode: true }, "diff"]
  ] as const)(
    "mounts mode %# through the shared component, updates and tears down once",
    (options, kind) => {
      const { surface, renderer } = setup();
      const resources = [{ id: "web", name: "web" }];
      const controller = surface.render("graph-container", resources, options);
      expect(renderer.roots[0].props.graph).toEqual({ kind, resources });
      expect(renderer.roots[0].props.options).toBe(options);
      expect(controller?.update(null)).toBe(controller);
      expect(renderer.roots[0].updates).toEqual([]);
      controller?.update([]);
      expect(renderer.roots[0].updates[0].graph.resources).toEqual([]);
      controller?.destroy();
      controller?.destroy();
      controller?.update(resources);
      expect(renderer.roots[0].unmounts).toBe(1);
      expect(renderer.roots[0].updates).toHaveLength(1);
    }
  );
  it("isolates replacement and simultaneous roots from stale controllers", () => {
    const { surface, renderer, browser } = setup();
    browser.document.add(createFakeElement("other"));
    const first = surface.render("graph-container", []);
    surface.render("graph-container", []);
    surface.render("other", null);
    first?.destroy();
    first?.update([{ id: "stale" }]);
    expect(renderer.roots.map((root) => root.unmounts)).toEqual([1, 0, 0]);
    surface.destroyAll();
    surface.destroyAll();
    expect(renderer.roots.map((root) => root.unmounts)).toEqual([1, 1, 1]);
  });
  it("leaves absent page containers alone", () => {
    const { surface, renderer } = setup();
    expect(surface.render("absent", [])).toBeNull();
    surface.setLoading("absent");
    surface.setError("absent", "error");
    expect(renderer.roots).toEqual([]);
  });
  it("unmounts before showing loading or escaped error state", () => {
    const { surface, renderer, container } = setup();
    surface.render("graph-container", []);
    surface.setLoading("graph-container");
    expect(container.innerHTML).toBe(GRAPH_LOADING_HTML);
    expect(renderer.roots[0].unmounts).toBe(1);
    surface.render("graph-container", []);
    surface.setError("graph-container", "<script>bad</script>");
    expect(container.querySelector(".error")?.textContent).toBe(
      "<script>bad</script>"
    );
    expect(container.querySelector(".error")?.getAttribute("role")).toBe(
      "alert"
    );
    expect(renderer.roots[1].unmounts).toBe(1);
  });
  it.each([false, true])(
    "surfaces missing and failed mounting with reload recovery: %s",
    (throws) => {
      const { browser, container } = setup();
      const surface = createGraphSurface(browser.context, () =>
        throws ?
          () => {
            throw new Error("mount failed");
          }
        : null
      );
      expect(surface.render("graph-container", [])).toBeNull();
      expect(container.querySelector(".error")?.textContent).toBe(
        throws ? GRAPH_RENDER_ERROR : GRAPH_LIBRARY_ERROR
      );
      container.querySelector("button")?.dispatchEvent?.({ type: "click" });
      expect(browser.nav.reloads).toBe(1);
      expect(browser.logger.errors).toHaveLength(throws ? 1 : 0);
    }
  );
  it("threads callbacks without introducing networking into graph-react", async () => {
    const { surface, renderer, browser } = setup();
    surface.render("graph-container", []);
    const callbacks = renderer.roots[0].props.callbacks;
    callbacks?.onRetry?.();
    callbacks?.onOpenExternal?.("javascript:bad");
    callbacks?.onOpenExternal?.("https://example.test/path");
    browser.net.handle(OPEN_SOURCE_PATH, () => jsonResponse({}));
    callbacks?.onOpenSource?.({
      path: "src/web.ts",
      line: 3,
      fallbackUrl: "https://example.test/fallback"
    });
    await flushPromises();
    expect(browser.net.calls[0]).toMatchObject({
      url: OPEN_SOURCE_PATH,
      init: { body: JSON.stringify({ path: "src/web.ts", line: 3 }) }
    });
    expect(browser.nav.reloads).toBe(1);
    expect(browser.external.opened).toEqual(["https://example.test/path"]);
  });

  it.each(["http", "network"] as const)(
    "falls back to safe remote source on a %s failure",
    async (failure) => {
      const { surface, browser } = setup();
      browser.net.handle(OPEN_SOURCE_PATH, () => {
        if (failure === "network") throw new Error("offline");
        return jsonResponse({}, false, 404);
      });
      surface.openLocalSource("src/web.ts", 0, "https://example.test/fallback");
      await flushPromises();
      expect(browser.external.opened).toEqual([
        "https://example.test/fallback"
      ]);
      surface.openLocalSource("", 0, "https://example.test/no-local-source");
      expect(browser.net.calls).toHaveLength(1);
      expect(browser.external.opened).toHaveLength(2);
    }
  );

  it("does not act on callbacks from a replaced root or a late failed source request", async () => {
    const { surface, browser, renderer } = setup();
    let reject: (error: Error) => void = () => {
      throw new Error("request not started");
    };
    browser.net.handle(
      OPEN_SOURCE_PATH,
      () =>
        new Promise((_resolve, rejectRequest) => {
          reject = rejectRequest;
        })
    );
    surface.render("graph-container", []);
    const callbacks = renderer.roots[0].props.callbacks;
    callbacks?.onOpenSource?.({
      path: "src/web.ts",
      line: 0,
      fallbackUrl: "https://example.test/fallback"
    });
    await flushPromises();
    surface.destroyAll();
    reject(new Error("late request failed"));
    await flushPromises();
    callbacks?.onOpenExternal?.("https://example.test/stale");
    callbacks?.onRetry?.();
    callbacks?.onOpenSource?.({ path: "stale", line: 0, fallbackUrl: "" });
    expect(browser.external.opened).toEqual([]);
    expect(browser.nav.reloads).toBe(0);
    expect(browser.net.calls).toHaveLength(1);
  });

  it("cleans every host and reports unmount failures without abandoning later roots", () => {
    const { browser, renderer } = setup();
    browser.document.add(createFakeElement("other"));
    const surface = createGraphSurface(browser.context, () => (host, props) => {
      const root = renderer.mount(host, props);
      return {
        ...root,
        unmount() {
          root.unmount();
          throw new Error("unmount failed");
        }
      };
    });
    surface.render("graph-container", []);
    surface.render("other", []);
    expect(() => surface.destroyAll()).toThrow(AggregateError);
    expect(renderer.roots.map((root) => root.unmounts)).toEqual([1, 1]);
    expect(() => surface.destroyAll()).not.toThrow();
  });
});
