import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import {
  mountRadiusClaudeApp,
  RadiusClaudeApp
} from "../../src/browser/app.js";
import type { RadiusAppPort } from "../../src/browser/app.js";

function createApp(): RadiusAppPort {
  return {
    ontoolinput: undefined,
    ontoolresult: undefined,
    onhostcontextchanged: undefined,
    connect: vi.fn(async () => {}),
    getHostContext: vi.fn(() => ({ theme: "dark" as const })),
    callServerTool: vi.fn(async () => ({
      content: [],
      structuredContent: {
        status: "ready",
        definitionFile: "app.bicep",
        graph: {
          kind: "modeled",
          resources: [{ id: "database", name: "database" }]
        }
      }
    })),
    openLink: vi.fn(async () => ({})),
    sendMessage: vi.fn(async () => ({})),
    updateModelContext: vi.fn(async () => ({}))
  };
}

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = "";
});

describe("RadiusClaudeApp", () => {
  it("renders the initial tool result with the shared graph library", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp();
    cleanup = mountRadiusClaudeApp(host, app);

    await expect
      .element(page.getByText("Loading the Radius application graph..."))
      .toBeVisible();
    await app.ontoolinput?.({ arguments: { appBicepPath: "app.bicep" } });
    await app.ontoolresult?.({
      content: [],
      structuredContent: {
        status: "ready",
        definitionFile: "app.bicep",
        graph: {
          kind: "modeled",
          resources: [
            {
              id: "web",
              name: "web",
              type: "Radius.Compute/containers"
            }
          ]
        }
      }
    });

    await expect.element(page.getByText("web")).toBeVisible();
    await expect
      .element(page.getByText("1 resource from app.bicep"))
      .toBeVisible();

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect.element(page.getByText("database")).toBeVisible();
    expect(app.callServerTool).toHaveBeenCalledWith({
      name: "show_application_graph",
      arguments: { appBicepPath: "app.bicep" }
    });
  });

  it("renders tool and connection failures as alerts", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    cleanup = () => root.unmount();
    const app = createApp();
    vi.mocked(app.connect).mockRejectedValue(new Error("host unavailable"));
    root.render(createElement(RadiusClaudeApp, { app }));

    await expect
      .element(
        page.getByRole("alert").getByText(/could not connect: host unavailable/)
      )
      .toBeVisible();

    await app.ontoolresult?.({
      isError: true,
      content: [{ type: "text", text: "rad compile failed" }]
    });
    await expect
      .element(page.getByRole("alert").getByText("rad compile failed"))
      .toBeVisible();
  });

  it("applies host changes and surfaces refresh failures", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    cleanup = () => root.unmount();
    const app = createApp();
    root.render(createElement(RadiusClaudeApp, { app }));
    await vi.waitFor(() => {
      expect(app.ontoolresult).toBeTypeOf("function");
      expect(app.onhostcontextchanged).toBeTypeOf("function");
    });
    await app.ontoolresult?.({
      content: [],
      structuredContent: {
        status: "ready",
        definitionFile: "app.bicep",
        graph: { kind: "modeled", resources: [] }
      }
    });

    await app.onhostcontextchanged?.({
      theme: "light",
      safeAreaInsets: { top: 4, right: 3, bottom: 2, left: 1 }
    });
    await expect
      .element(page.getByText("0 resources from app.bicep"))
      .toBeVisible();
    expect(document.querySelector("main")?.style.paddingTop).toBe("4px");

    vi.mocked(app.callServerTool).mockRejectedValue("offline");
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect
      .element(
        page.getByRole("alert").getByText(/could not be refreshed: offline/)
      )
      .toBeVisible();
  });
});
