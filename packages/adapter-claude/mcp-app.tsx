import { App } from "@modelcontextprotocol/ext-apps";
import "@radius-project/graph-react/styles.css";
import "./src/browser/app.css";
import { mountRadiusClaudeApp } from "./src/browser/app.js";

const host = document.getElementById("root");
if (!(host instanceof HTMLElement)) {
  throw new Error("Radius MCP App root element was not found.");
}

mountRadiusClaudeApp(
  host,
  new App({ name: "Radius application graph", version: "0.1.0" })
);
