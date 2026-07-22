import { readFileSync } from "node:fs";
import * as z from "zod/v4";

const relativeRuntimePath = z.string().min(1).refine((value) => {
  const normalized = value.replaceAll("\\", "/");
  return !normalized.startsWith("/") && !normalized.split("/").includes("..");
}, "Path must be relative and remain inside SimSpace.");
const moduleSpecifier = z.string().min(1).max(256).regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:\/[a-zA-Z0-9._/-]+)?$/);

const actionPolicy = z.record(z.string(), z.object({
  destructive: z.boolean().optional(),
  mutatesWorld: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  replayable: z.boolean().optional(),
  rollback: z.enum(["snapshot", "replay", "none"]).optional(),
}).strict());

export const executionProfileSchema = z.object({
  schemaVersion: z.literal("nexus.execution-profile.v1").default("nexus.execution-profile.v1"),
  adapter: z.enum(["browser", "nexus-headless"]).optional(),
  stageRoot: z.string().min(1).optional(),
  allowedWorkspaceRoots: z.array(relativeRuntimePath).default([]),
  allowDestructive: z.boolean().default(false),
  environmentAllowlist: z.array(z.string().min(1)).default([]),
  outputRoots: z.array(relativeRuntimePath).default(["output", "artifacts", "logs", "temp"]),
  launch: z.object({
    command: z.array(z.string().min(1)).min(1).optional(),
    cwd: relativeRuntimePath.default("."),
    env: z.record(z.string(), z.string()).default({}),
    timeoutMs: z.number().int().positive().max(120000).default(30000),
    urlPath: z.string().default("/"),
    waitPath: z.string().default("/"),
  }).strict().optional(),
  modulePath: relativeRuntimePath.optional(),
  moduleSpecifier: moduleSpecifier.optional(),
  runtimeExport: z.string().min(1).default("createHeadlessEditorRuntime"),
  runtimeOptions: z.record(z.string(), z.unknown()).default({}),
  environmentModulePath: relativeRuntimePath.optional(),
  environmentModuleSpecifier: moduleSpecifier.optional(),
  environmentExport: z.string().min(1).default("createEnvironment"),
  environmentId: z.string().min(1).optional(),
  allowActions: z.array(z.string().min(1)).default([]),
  actionSchemas: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  actionPolicy: actionPolicy.default({}),
  resourceLimits: z.object({
    memory: z.enum(["best-effort", "hard"]).default("best-effort"),
    memoryMb: z.number().int().positive().max(65536).optional(),
  }).strict().prefault({}),
}).strict().superRefine((profile, context) => {
  if (profile.modulePath && profile.moduleSpecifier) {
    context.addIssue({ code: "custom", message: "Use modulePath or moduleSpecifier, not both.", path: ["moduleSpecifier"] });
  }
  if (profile.environmentModulePath && profile.environmentModuleSpecifier) {
    context.addIssue({ code: "custom", message: "Use environmentModulePath or environmentModuleSpecifier, not both.", path: ["environmentModuleSpecifier"] });
  }
});

export function loadExecutionProfile(path, adapter) {
  if (!path) return executionProfileSchema.parse({ adapter });
  const profile = executionProfileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (profile.adapter && profile.adapter !== adapter) {
    throw new Error(`Execution profile adapter "${profile.adapter}" does not match requested adapter "${adapter}".`);
  }
  return profile;
}
