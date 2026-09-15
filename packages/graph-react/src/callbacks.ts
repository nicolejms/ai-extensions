import type { GraphNodeData } from "./build.js";

export interface GraphCallbacks {
  onOpenExternal?(url: string): void;
  onOpenSource?(source: {
    path: string;
    line: number;
    fallbackUrl: string;
  }): void;
  onSelect?(node: GraphNodeData): void;
  onDetails?(node: GraphNodeData, open: boolean): void;
  onNavigate?(node: GraphNodeData): void;
  onRetry?(): void;
}
