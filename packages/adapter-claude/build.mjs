import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const distDir = join(packageRoot, "dist");
const target = `node${readFileSync(
  resolve(packageRoot, "../../.node-version"),
  "utf8"
).trim()}`;

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const browserBuild = await esbuild.build({
  entryPoints: [join(packageRoot, "mcp-app.tsx")],
  bundle: true,
  write: false,
  outdir: "out",
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  charset: "utf8",
  minify: true,
  legalComments: "none",
  loader: {
    ".css": "css"
  }
});

const browserScript = browserBuild.outputFiles.find((file) =>
  file.path.endsWith(".js")
);
const browserStyle = browserBuild.outputFiles.find((file) =>
  file.path.endsWith(".css")
);
if (!browserScript || !browserStyle) {
  throw new Error("Radius MCP App build did not emit JavaScript and CSS.");
}

const template = readFileSync(join(packageRoot, "mcp-app.html"), "utf8");
const html = template
  .replace("<!-- STYLES -->", `<style>${browserStyle.text}</style>`)
  .replace("<!-- SCRIPT -->", `<script>${browserScript.text}</script>`);
writeFileSync(join(distDir, "mcp-app.html"), html);

await esbuild.build({
  stdin: {
    contents: `
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createRadiusClaudeServer } from "./src/server.ts";

const server = createRadiusClaudeServer();
await server.connect(new StdioServerTransport());
`,
    resolveDir: packageRoot,
    sourcefile: "radius-claude-entry.ts",
    loader: "ts"
  },
  outfile: join(distDir, "server.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target,
  charset: "utf8",
  sourcemap: false,
  legalComments: "none",
  logLevel: "silent"
});
