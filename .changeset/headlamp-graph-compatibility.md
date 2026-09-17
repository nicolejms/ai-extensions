---
"@radius-project/graph-react": patch
---

**Fixed:** Support Headlamp's classic TypeScript module resolution, initialize graph layout in its published plugin toolchain without host globals, and prevent bundled React Flow styles from changing the host's own graph controls and nodes. Both stylesheets now scope their rules, so they require Chromium/Edge 118 or later, Safari 17.4 or later, or Firefox 146 or later.
