import { describe, expect, it, vi } from "vitest";
import { createGraphCallbacks, outputFromToolResult } from "./app.js";
import type { RadiusAppPort } from "./app.js";

function createApp(): RadiusAppPort {
  return {
    ontoolinput: undefined,
    ontoolresult: undefined,
    onhostcontextchanged: undefined,
    connect: vi.fn(async () => {}),
    getHostContext: vi.fn(() => undefined),
    callServerTool: vi.fn(async () => ({ content: [] })),
    openLink: vi.fn(async () => ({})),
    sendMessage: vi.fn(async () => ({})),
    updateModelContext: vi.fn(async () => ({}))
  };
}

describe("outputFromToolResult", () => {
  it("uses validated structured output", () => {
    expect(
      outputFromToolResult({
        content: [],
        structuredContent: {
          status: "ready",
          definitionFile: "app.bicep",
          graph: { kind: "modeled", resources: [] }
        }
      })
    ).toMatchObject({ status: "ready", definitionFile: "app.bicep" });
  });

  it("surfaces text from an invalid or failed result", () => {
    expect(
      outputFromToolResult({
        isError: true,
        content: [
          {
            type: "image",
            data: "AA==",
            mimeType: "image/png"
          },
          { type: "text", text: "Graph compilation failed." }
        ]
      })
    ).toEqual({
      status: "error",
      message: "Graph compilation failed."
    });
  });

  it("reports a malformed response without text", () => {
    expect(outputFromToolResult({ content: [] })).toEqual({
      status: "error",
      message: "The Radius graph tool returned an invalid response."
    });
  });
});

describe("createGraphCallbacks", () => {
  it("forwards external links, source selections, and model context", async () => {
    const app = createApp();
    const callbacks = createGraphCallbacks(app);

    callbacks.onOpenExternal?.("https://example.test/resource");
    callbacks.onOpenSource?.({
      path: "src/app.ts",
      line: 12,
      fallbackUrl: "https://example.test/src/app.ts"
    });
    callbacks.onOpenSource?.({
      path: "",
      line: 0,
      fallbackUrl: "https://example.test/fallback"
    });
    callbacks.onSelect?.({
      id: "web",
      borderColor: "",
      borderWidth: 1,
      bgColor: "",
      icon: "",
      nodeName: "web",
      typeLabel: "Container",
      codeRef: "",
      sourceUrl: "",
      srcPath: "",
      srcLine: 0,
      defFile: "",
      defLine: 0,
      resourceType: "Radius.Compute/containers",
      diffStatus: "",
      deployStatus: "",
      portalUrl: "",
      cloudResources: "[]"
    });
    await Promise.resolve();

    expect(app.openLink).toHaveBeenCalledWith({
      url: "https://example.test/resource"
    });
    expect(app.sendMessage).toHaveBeenNthCalledWith(1, {
      role: "user",
      content: [
        {
          type: "text",
          text: "Open src/app.ts:12 from the Radius application graph."
        }
      ]
    });
    expect(app.sendMessage).toHaveBeenNthCalledWith(2, {
      role: "user",
      content: [
        {
          type: "text",
          text: "Open https://example.test/fallback from the Radius application graph."
        }
      ]
    });
    expect(app.updateModelContext).toHaveBeenCalledWith({
      content: [
        {
          type: "text",
          text: "Selected Radius resource web (Radius.Compute/containers)."
        }
      ]
    });
  });

  it("logs callback failures without creating unhandled rejections", async () => {
    const app = createApp();
    vi.mocked(app.openLink).mockRejectedValue(new Error("blocked"));
    vi.mocked(app.sendMessage).mockRejectedValue(new Error("blocked"));
    vi.mocked(app.updateModelContext).mockRejectedValue(new Error("blocked"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const callbacks = createGraphCallbacks(app);

    callbacks.onOpenExternal?.("https://example.test");
    callbacks.onOpenSource?.({
      path: "src/app.ts",
      line: 0,
      fallbackUrl: ""
    });
    callbacks.onSelect?.({
      id: "web",
      borderColor: "",
      borderWidth: 1,
      bgColor: "",
      icon: "",
      nodeName: "web",
      typeLabel: "Container",
      codeRef: "",
      sourceUrl: "",
      srcPath: "",
      srcLine: 0,
      defFile: "",
      defLine: 0,
      resourceType: "",
      diffStatus: "",
      deployStatus: "",
      portalUrl: "",
      cloudResources: "[]"
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(error).toHaveBeenCalledTimes(3);
    error.mockRestore();
  });
});
