---
"@radius-project/graph-react": minor
"radius": patch
---

Publish the Radius brand mark from the shared graph library so every host renders one canonical definition.

`@radius-project/graph-react/brand` is a new React-free, DOM-free subpath exporting `RADIUS_BRAND_MARK` for icon registries and `radiusBrandMarkSvg` for hosts that inline markup. A host can now register the Radius icon for its own navigation without loading the renderer.

Canvas's `radiusMark` now delegates to the shared mark. Rendered markup is byte-identical, so page output, browser behavior, and visual baselines are unchanged.
