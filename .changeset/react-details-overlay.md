---
"@radius-project/graph-react": patch
---

**Changed:** The resource details overlay is now an ordinary controlled React element rather than an element the component appends to its own drawing area. It stays anchored to the card it describes when a relayout or a drag moves that card, closes when its resource disappears from refreshed data, and continues to keep its position, focus restoration and keyboard behavior across host re-renders.
