import { afterEach, describe, expect, it } from "vitest";
import { waitFor, within } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { mountRadiusGraph } from "@radius-project/graph-react";
import "@radius-project/graph-react/styles.css";
import { installGraphEntry } from "../../src/browser/entries/graph.js";
import { asGraphController } from "../../src/browser/graph/surface.js";
import { createRealScope, jsonResponse } from "./support/real-scope.js";

const dispose: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of dispose.splice(0).reverse()) cleanup();
});

describe("Canvas entry with the canonical renderer in Chromium", () => {
  it("mounts through native host ports, opens local source over HTTP, updates and tears down", async () => {
    const real = createRealScope({
      route: () => jsonResponse(200, { opened: true })
    });
    real.host.id = "graph-component-host";
    real.host.style.width = "850px";
    real.host.style.height = "650px";
    const teardown = installGraphEntry(real.scope, mountRadiusGraph);
    dispose.push(() => {
      teardown();
      real.dispose();
    });
    const render: unknown = Reflect.get(real.scope, "radiusRenderGraph");
    if (typeof render !== "function")
      throw new Error("Canvas did not publish radiusRenderGraph");
    const resources = [
      {
        id: "app/web",
        name: "web",
        type: "Radius.Compute/containers",
        codeReference: "src/web.ts#L7"
      }
    ];
    const controller = asGraphController(
      render(real.host.id, resources, {
        localSource: true,
        repoUrl: "https://github.com/example/app",
        branch: "feature"
      })
    );
    const card = await within(real.host).findByRole("group", { name: "web" });
    await userEvent.click(
      within(card).getByRole("link", { name: /View source code/ })
    );
    await waitFor(() => expect(real.requests).toHaveLength(1));
    expect(real.requests[0]).toMatchObject({
      url: "/api/open-source",
      method: "POST",
      body: { path: "src/web.ts", line: 7 }
    });
    expect(
      real.host.querySelector("[data-radius-details]")?.getAttribute("style")
    ).toMatch(/display:\s*none/);
    controller?.update([{ ...resources[0], name: "renamed" }]);
    await within(real.host).findByRole("group", { name: "renamed" });
    teardown();
    await waitFor(() =>
      expect(real.host.querySelector(".react-flow")).toBeNull()
    );
    controller?.update(resources);
    expect(real.host.querySelector(".react-flow")).toBeNull();
  });
});
