export interface ResourceId {
  readonly id: string;
  readonly plane: { readonly type: string; readonly name: string };
  readonly resourceGroup: string;
  readonly provider: string;
  readonly type: string;
  readonly name: string;
  readonly segments: readonly {
    readonly type: string;
    readonly name: string;
  }[];
}

/** Parse a UCP resource identity without discarding nested resource types. */
export function parseResourceId(id: string): ResourceId | undefined {
  if (!id.startsWith("/") || /[\s?#\\\u0000-\u001f]/.test(id)) return undefined;
  const parts = id.slice(1).split("/");
  if (
    parts.length < 9 ||
    parts.length % 2 !== 1 ||
    parts[0].toLowerCase() !== "planes" ||
    parts[3].toLowerCase() !== "resourcegroups" ||
    parts[5].toLowerCase() !== "providers" ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    return undefined;
  }
  const segments: Array<{ type: string; name: string }> = [];
  for (let index = 7; index < parts.length; index += 2) {
    segments.push({ type: parts[index], name: parts[index + 1] });
  }
  return {
    id,
    plane: { type: parts[1], name: parts[2] },
    resourceGroup: parts[4],
    provider: parts[6],
    type: [parts[6], ...segments.map((segment) => segment.type)].join("/"),
    name: parts[parts.length - 1],
    segments
  };
}
