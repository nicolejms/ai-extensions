---
"@radius-project/graph-react": patch
---

**Fixed:** Keep an open resource details overlay, its restorable keyboard focus, and dragged node positions when the host application re-renders with newly allocated `options` and `callbacks` objects, which is what an ordinary inline JSX usage produces. Event handling continues to reach the host's newest callbacks.
