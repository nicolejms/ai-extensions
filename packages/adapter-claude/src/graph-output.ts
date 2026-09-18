import { z } from "zod/v4";

const ResourceOutputSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    displayType: z.string().optional(),
    deployStatus: z.string().optional(),
    portalUrl: z.string().optional()
  })
  .passthrough();

const ResourceConnectionSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    direction: z.string().optional(),
    diffStatus: z.string().optional()
  })
  .passthrough();

export const GraphResourceSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    displayType: z.string().optional(),
    icon: z.string().optional(),
    codeReference: z.string().optional(),
    definitionFile: z.string().optional(),
    definitionLine: z.number().optional(),
    diffStatus: z.string().optional(),
    deployStatus: z.string().optional(),
    deployMessage: z.string().optional(),
    portalUrl: z.string().optional(),
    provisioningState: z.string().optional(),
    outputResources: z.array(ResourceOutputSchema.nullable()).optional(),
    connections: z.array(ResourceConnectionSchema.nullable()).optional()
  })
  .passthrough();

const ReadyGraphOutputSchema = z.object({
  status: z.literal("ready"),
  definitionFile: z.string(),
  graph: z.object({
    kind: z.literal("modeled"),
    resources: z.array(GraphResourceSchema)
  })
});

const ErrorGraphOutputSchema = z.object({
  status: z.literal("error"),
  message: z.string(),
  requestedPath: z.string().optional()
});

export const GraphToolOutputSchema = z.discriminatedUnion("status", [
  ReadyGraphOutputSchema,
  ErrorGraphOutputSchema
]);

export type GraphToolOutput = z.infer<typeof GraphToolOutputSchema>;
export type ReadyGraphOutput = z.infer<typeof ReadyGraphOutputSchema>;

export function parseGraphToolOutput(value: unknown): GraphToolOutput | null {
  const result = GraphToolOutputSchema.safeParse(value);
  return result.success ? result.data : null;
}
