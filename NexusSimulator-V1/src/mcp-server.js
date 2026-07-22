import { randomUUID } from "node:crypto";
import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { isInitializeRequest, McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createWorldActionSurface } from "./world-actions.js";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function toolResult(result) {
  const structuredContent = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : { result };
  const links = (structuredContent.artifacts ?? [])
    .filter((artifact) => artifact && typeof artifact === "object" && String(artifact.uri ?? "").startsWith("nexus-sim://"))
    .map((artifact) => ({
      type: "resource_link",
      name: artifact.name ?? "NexusSimulator artifact",
      uri: artifact.uri,
    }));
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }, ...links],
    isError: structuredContent.status === "failed",
    structuredContent,
  };
}

function toolError(error) {
  const structuredContent = {
    error: {
      code: error?.code ?? "ACTION_FAILED",
      message: error?.message ?? String(error),
    },
    status: "failed",
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    isError: true,
    structuredContent,
  };
}

export function createNexusMcpServer(surface) {
  const server = new McpServer({ name: "nexus-simulator", version: "0.0.3-development" }, {
    instructions: "Use harness.manifest for discovery. Use world.batch_command for connected world mutations. Run dryRun first for unfamiliar actions. Individual world mutation tools are intentionally not exposed.",
  });

  for (const manifest of surface.manifests()) {
    const action = surface.registry.get(manifest.id);
    server.registerTool(action.id, {
      annotations: {
        destructiveHint: action.safety.destructive === true,
        idempotentHint: action.safety.replayable === true,
        openWorldHint: false,
        readOnlyHint: action.safety.readOnly === true,
      },
      description: action.description,
      inputSchema: action.inputSchema,
      outputSchema: action.outputSchema,
      title: action.title,
    }, async (input, context) => {
      const progressToken = context.mcpReq?._meta?.progressToken;
      try {
        if (progressToken !== undefined) {
          await context.mcpReq.notify({
            method: "notifications/progress",
            params: { message: `${action.id} started`, progress: 0, progressToken, total: 1 },
          }).catch(() => {});
        }
        const result = await surface.dispatch(action.id, input, { signal: context.mcpReq?.signal });
        if (progressToken !== undefined) {
          await context.mcpReq.notify({
            method: "notifications/progress",
            params: { message: `${action.id} completed`, progress: 1, progressToken, total: 1 },
          }).catch(() => {});
        }
        return toolResult(result);
      } catch (error) {
        return toolError(error);
      }
    });
  }
  return server;
}

export async function startMcpStdioServer(options = {}) {
  const surface = options.surface ?? createWorldActionSurface({ ...options, keepAlive: true });
  const server = createNexusMcpServer(surface);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return {
    close: async () => {
      await server.close();
      await surface.shutdown();
    },
    server,
    surface,
    transport,
  };
}

function requireLanToken(host, token) {
  if (LOCAL_HOSTS.has(host)) return null;
  if (!token || token.length < 32) {
    const error = new Error("LAN MCP binding requires NEXUS_SIM_MCP_TOKEN with at least 32 characters.");
    error.code = "MCP_LAN_TOKEN_REQUIRED";
    throw error;
  }
  return token;
}

function bearerToken(request) {
  const header = request.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

export async function startMcpHttpServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = Number(options.port ?? 8765);
  const token = requireLanToken(host, options.token ?? process.env.NEXUS_SIM_MCP_TOKEN);
  const allowedHosts = options.allowedHosts?.length
    ? options.allowedHosts
    : LOCAL_HOSTS.has(host)
      ? [host, "localhost", "127.0.0.1"]
      : null;
  if (!allowedHosts?.length) throw new Error("LAN MCP binding requires at least one --allowed-host value.");
  if (allowedHosts.some((allowedHost) => allowedHost.includes("*"))) {
    const error = new Error("MCP Host allowlists must contain exact hostnames, not wildcards.");
    error.code = "MCP_UNSAFE_HOST_ALLOWLIST";
    throw error;
  }

  const surface = options.surface ?? createWorldActionSurface({ ...options, keepAlive: true });
  const app = createMcpExpressApp({ host, allowedHosts });
  app.use(express.json({ limit: "1mb" }));
  app.use("/mcp", (request, response, next) => {
    if (!token || bearerToken(request) === token) return next();
    response.status(401).json({ error: "unauthorized" });
  });

  const sessions = new Map();

  async function createTransport() {
    let transport;
    const server = createNexusMcpServer(surface);
    transport = new NodeStreamableHTTPServerTransport({
      enableJsonResponse: true,
      onsessionclosed: async (sessionId) => {
        sessions.delete(sessionId);
        await server.close().catch(() => {});
      },
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, { server, transport });
      },
      sessionIdGenerator: () => randomUUID(),
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    return { server, transport };
  }

  app.post("/mcp", async (request, response) => {
    try {
      const sessionId = request.headers["mcp-session-id"];
      let entry = sessionId ? sessions.get(String(sessionId)) : null;
      if (!entry && !isInitializeRequest(request.body)) {
        response.status(400).json({ error: "missing or invalid MCP session" });
        return;
      }
      if (!entry) entry = await createTransport();
      await entry.transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (!response.headersSent) response.status(500).json({ error: error.message });
    }
  });

  const handleExistingSession = async (request, response) => {
    const sessionId = String(request.headers["mcp-session-id"] ?? "");
    const entry = sessions.get(sessionId);
    if (!entry) {
      response.status(404).json({ error: "unknown MCP session" });
      return;
    }
    await entry.transport.handleRequest(request, response);
  };
  app.get("/mcp", handleExistingSession);
  app.delete("/mcp", handleExistingSession);

  const httpServer = await new Promise((resolveServer, reject) => {
    const server = app.listen(port, host, () => resolveServer(server));
    server.once("error", reject);
  });

  async function close() {
    await Promise.all([...sessions.values()].map(async (entry) => {
      await entry.transport.close().catch(() => {});
      await entry.server.close().catch(() => {});
    }));
    sessions.clear();
    await surface.shutdown();
    await new Promise((resolveClose) => httpServer.close(resolveClose));
  }

  return {
    address: httpServer.address(),
    app,
    close,
    httpServer,
    sessions,
    surface,
  };
}
