import * as z from "zod/v4";

const emptyArgs = z.object({}).strict();
const vector3 = z.tuple([z.number(), z.number(), z.number()]);
const controls = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

const descriptors = [
  {
    id: "world.observe",
    title: "Observe world",
    argsSchema: emptyArgs,
    safety: { destructive: false, mutatesWorld: false, readOnly: true, replayable: true, rollback: "snapshot" },
  },
  {
    id: "world.validate",
    title: "Validate world",
    argsSchema: z.object({ id: z.string().min(1).optional() }).strict(),
    safety: { destructive: false, mutatesWorld: true, readOnly: false, replayable: true, rollback: "snapshot" },
  },
  {
    id: "world.capture",
    title: "Capture world evidence",
    argsSchema: z.object({ name: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).default("world-capture.png") }).prefault({}),
    safety: { destructive: false, mutatesWorld: false, readOnly: true, replayable: true, rollback: "snapshot" },
  },
  {
    id: "world.object.select",
    title: "Select world object",
    argsSchema: z.object({ id: z.string().min(1) }).strict(),
    safety: { destructive: false, mutatesWorld: true, readOnly: false, replayable: true, rollback: "snapshot" },
  },
  {
    id: "world.object.update",
    title: "Update world object",
    argsSchema: z.object({
      id: z.string().min(1),
      controls: controls.optional(),
      position: vector3.optional(),
      rotation: z.union([z.number(), vector3]).optional(),
      scale: z.union([z.number().positive(), vector3]).optional(),
    }).strict().refine((value) => value.controls || value.position || value.rotation !== undefined || value.scale !== undefined, "At least one update is required."),
    safety: { destructive: false, mutatesWorld: true, readOnly: false, replayable: true, rollback: "snapshot" },
  },
  {
    id: "world.object.regenerate",
    title: "Regenerate world object",
    argsSchema: z.object({ id: z.string().min(1), seed: z.union([z.string().min(1), z.number()]) }).strict(),
    safety: { destructive: false, mutatesWorld: true, readOnly: false, replayable: true, rollback: "snapshot" },
  },
  {
    id: "world.object.commit",
    title: "Commit world object",
    argsSchema: z.object({ id: z.string().min(1) }).strict(),
    safety: { destructive: true, mutatesWorld: true, readOnly: false, replayable: true, rollback: "snapshot" },
  },
  {
    id: "world.terrain.rebuild",
    title: "Rebuild terrain",
    argsSchema: z.object({ seed: z.union([z.string().min(1), z.number()]), parameters: controls.optional() }).strict(),
    safety: { destructive: false, mutatesWorld: true, readOnly: false, replayable: true, rollback: "snapshot" },
  },
  {
    id: "world.settings.update",
    title: "Update world settings",
    argsSchema: z.object({ worldStructure: z.string().min(1).optional(), worldType: z.string().min(1).optional() }).strict()
      .refine((value) => value.worldStructure || value.worldType, "worldStructure or worldType is required."),
    safety: { destructive: false, mutatesWorld: true, readOnly: false, replayable: true, rollback: "snapshot" },
  },
];

const builtins = new Map(descriptors.map((descriptor) => [descriptor.id, Object.freeze(descriptor)]));

export function isBuiltinWorldCommand(id) {
  return builtins.has(id);
}

export function listWorldCommands() {
  return [...builtins.values()].map((descriptor) => ({
    id: descriptor.id,
    inputSchema: z.toJSONSchema(descriptor.argsSchema),
    safety: descriptor.safety,
    title: descriptor.title,
  }));
}

export function resolveWorldCommand(id, adapterCapabilities = []) {
  const builtin = builtins.get(id);
  if (builtin) {
    if (!adapterCapabilities.some((entry) => entry.id === id)) {
      const error = new Error(`World adapter does not support "${id}".`);
      error.code = "CAPABILITY_UNAVAILABLE";
      throw error;
    }
    return builtin;
  }
  const dynamic = adapterCapabilities.find((entry) => entry.id === id && entry.allowlisted === true);
  if (!dynamic) {
    const error = new Error(`Unknown or non-allowlisted world action "${id}".`);
    error.code = "UNKNOWN_WORLD_ACTION";
    throw error;
  }
  if (!dynamic.inputSchema) {
    const error = new Error(`Allowlisted DSK action "${id}" does not declare an input schema.`);
    error.code = "ACTION_SCHEMA_REQUIRED";
    throw error;
  }
  let argsSchema;
  try {
    argsSchema = z.fromJSONSchema(dynamic.inputSchema);
  } catch (cause) {
    const error = new Error(`Allowlisted DSK action "${id}" has an invalid input schema.`);
    error.code = "ACTION_SCHEMA_INVALID";
    error.cause = cause;
    throw error;
  }
  return {
    argsSchema,
    id,
    safety: {
      destructive: dynamic.safety?.destructive === true,
      mutatesWorld: dynamic.safety?.mutatesWorld !== false,
      readOnly: dynamic.safety?.readOnly === true,
      replayable: dynamic.safety?.replayable === true,
      rollback: dynamic.safety?.rollback ?? "none",
    },
    title: dynamic.title ?? id,
  };
}
