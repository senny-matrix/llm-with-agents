import { tool as createTool } from "ai";
import { z } from "zod";
import { MCPClient, type MCPServerConfig } from "./client.ts";
import type { MCPTool } from "./types.ts";

/** Map of connected MCP clients keyed by server name */
const clients = new Map<string, MCPClient>();

/**
 * Convert an MCP tool's JSON Schema to a Zod schema for the agent tool system.
 * Handles the common subset: string, number, boolean, enum, and nested objects.
 */
function mcpSchemaToZod(schema: MCPTool["inputSchema"]): z.ZodTypeAny {
  if (!schema.properties || Object.keys(schema.properties).length === 0) {
    return z.object({});
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set(schema.required ?? []);

  for (const [key, prop] of Object.entries(schema.properties)) {
    let zodType: z.ZodTypeAny;

    switch (prop.type) {
      case "string":
        zodType = z.string();
        if (prop.enum && prop.enum.length > 0) {
          zodType = zodType.describe(
            `One of: ${prop.enum.join(", ")}`,
          );
        }
        break;
      case "number":
      case "integer":
        zodType = z.number();
        break;
      case "boolean":
        zodType = z.boolean();
        break;
      case "array":
        zodType = z.array(z.unknown());
        break;
      case "object":
        zodType = z.record(z.string(), z.unknown());
        break;
      default:
        zodType = z.unknown();
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description);
    }

    if (!required.has(key)) {
      zodType = zodType.optional();
    }

    shape[key] = zodType;
  }

  return z.object(shape);
}

/**
 * Register MCP tools from a connected client into the agent's tool map.
 */
function registerTools(client: MCPClient): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  for (const mcpTool of client.tools) {
    const zodSchema = mcpSchemaToZod(mcpTool.inputSchema);

    tools[mcpTool.name] = createTool({
      description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
      inputSchema: zodSchema,
      execute: async (args: unknown) => {
        try {
          const result = await client.callTool(
            mcpTool.name,
            args as Record<string, unknown>,
          );

          // Extract text content from the result
          const texts = (result.content ?? [])
            .filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
            .map((c) => c.text);

          if (result.isError) {
            return `MCP tool error: ${texts.join("\n")}`;
          }

          return texts.join("\n") || "(no output)";
        } catch (e) {
          return `MCP tool "${mcpTool.name}" failed: ${(e as Error).message}`;
        }
      },
    });
  }

  return tools;
}

/**
 * Connect to all configured MCP servers and return their tools.
 * Each tool is prefixed with the server name to avoid conflicts.
 */
export async function connectMCPServers(
  servers: MCPServerConfig[],
): Promise<Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTools: Record<string, any> = {};

  for (const config of servers) {
    try {
      const client = new MCPClient(config);
      await client.connect();
      clients.set(config.name, client);

      const tools = registerTools(client);
      // Prefix tools with server name to avoid conflicts
      for (const [toolName, toolDef] of Object.entries(tools)) {
        const prefixedName = `${config.name}__${toolName}`;
        allTools[prefixedName] = toolDef;
      }

      console.error(
        `MCP: Registered ${Object.keys(tools).length} tool(s) from "${config.name}"`,
      );
    } catch (e) {
      console.error(
        `MCP: Failed to connect to "${config.name}": ${(e as Error).message}`,
      );
      // Continue with other servers
    }
  }

  return allTools;
}

/**
 * Disconnect all MCP clients.
 */
export async function disconnectAll(): Promise<void> {
  for (const [name, client] of clients) {
    try {
      await client.disconnect();
    } catch {
      // Ignore errors during cleanup
    }
  }
  clients.clear();
}

/**
 * Get list of connected server names.
 */
export function getConnectedServers(): string[] {
  return Array.from(clients.keys());
}

/**
 * Re-discover tools from all connected servers.
 */
export async function refreshTools(): Promise<
  Record<string, unknown>
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTools: Record<string, any> = {};

  for (const [name, client] of clients) {
    try {
      await client.discoverTools();
      const tools = registerTools(client);
      for (const [toolName, toolDef] of Object.entries(tools)) {
        allTools[`${name}__${toolName}`] = toolDef;
      }
    } catch {
      // Skip servers that fail to refresh
    }
  }

  return allTools;
}
