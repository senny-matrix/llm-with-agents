import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  JSONRPCResponse,
  JSONRPCError,
  JSONRPCNotification,
  InitializeResult,
  ListToolsResult,
  CallToolResult,
  MCPTool,
} from "./types.ts";

/** Configuration for an MCP server connection */
export interface MCPServerConfig {
  /** Display name for logging */
  name: string;
  /** Command to spawn (e.g., "npx") */
  command: string;
  /** Arguments for the command (e.g., ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]) */
  args: string[];
  /** Environment variables for the server process */
  env?: Record<string, string>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Lightweight MCP client over stdio transport.
 *
 * Spawns the configured command as a subprocess, sends JSON-RPC
 * requests on stdin, and reads responses from stdout line by line.
 */
export class MCPClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private serverName: string;
  public tools: MCPTool[] = [];
  public connected = false;

  constructor(private config: MCPServerConfig) {
    this.serverName = config.name;
  }

  /** Start the server process and initialize the MCP connection */
  async connect(): Promise<void> {
    if (this.connected) return;

    const { command, args, env } = this.config;

    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    // Read JSON-RPC responses line by line from stdout
    const rl = createInterface({ input: this.process.stdout! });
    rl.on("line", (line: string) => {
      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch {
        // Skip non-JSON lines (some servers emit debug output)
      }
    });

    // Log stderr for debugging
    this.process.stderr?.on("data", (data: Buffer) => {
      // Quietly collect stderr — don't spam the TUI
    });

    this.process.on("exit", (code) => {
      this.connected = false;
      this.rejectAllPending(
        new Error(`MCP server "${this.serverName}" exited with code ${code}`),
      );
    });

    this.process.on("error", (err) => {
      this.connected = false;
      this.rejectAllPending(
        new Error(`MCP server "${this.serverName}" error: ${err.message}`),
      );
    });

    // Initialize the MCP connection
    const initResult = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: "agi",
        version: "1.0.0",
      },
    }) as InitializeResult;

    // Send initialized notification
    this.sendNotification("notifications/initialized", {});

    this.connected = true;
    console.error(
      `MCP: Connected to "${this.serverName}" (${initResult.serverInfo?.name ?? command} v${initResult.serverInfo?.version ?? "?"})`,
    );

    // Discover tools
    await this.discoverTools();
  }

  /** Discover and cache available tools from the server */
  async discoverTools(): Promise<MCPTool[]> {
    const result = (await this.sendRequest("tools/list", {})) as ListToolsResult;
    this.tools = result.tools ?? [];
    return this.tools;
  }

  /** Call a tool on the MCP server */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    return (await this.sendRequest("tools/call", {
      name,
      arguments: args,
    })) as CallToolResult;
  }

  /** Disconnect and clean up */
  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.rejectAllPending(new Error("MCP client disconnected"));
  }

  // ---- Internal ----

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.process || !this.process.stdin) {
      return Promise.reject(new Error("MCP client not connected"));
    }

    const id = this.nextId++;
    const request = {
      jsonrpc: "2.0" as const,
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      this.process!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.process?.stdin) return;
    const notification: JSONRPCNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    this.process.stdin.write(JSON.stringify(notification) + "\n");
  }

  private handleMessage(msg: Record<string, unknown>): void {
    // Check if it has an id (response/error) or no id (notification)
    if (msg.id !== undefined && msg.id !== null) {
      const pending = this.pending.get(msg.id as number | string);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(msg.id as number | string);

      if (msg.error) {
        const err = msg as unknown as JSONRPCError;
        pending.reject(
          new Error(
            `MCP error ${err.error.code}: ${err.error.message}`,
          ),
        );
      } else {
        const resp = msg as unknown as JSONRPCResponse;
        pending.resolve(resp.result);
      }
    }
    // Notifications are ignored for now
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
