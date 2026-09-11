/** DOM capabilities used by the details overlay, independent of any host. */
export interface GraphElement {
  id: string;
  innerHTML: string;
  readonly style: { display: string; left?: string; top?: string };
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  remove(): void;
  focus(): void;
  addEventListener(type: string, listener: (event: GraphEvent) => void): void;
  removeEventListener(
    type: string,
    listener: (event: GraphEvent) => void
  ): void;
}

export interface GraphEvent {
  readonly target?: unknown;
  preventDefault(): void;
}

export interface DetailsContext<Element extends GraphElement> {
  readonly dom: { createElement(tag: string): Element };
  readonly focus: {
    active(): Element | null;
    focus(element: Element | null): boolean;
  };
}
