import { Client } from '@modelcontextprotocol/sdk/client';
import type { Tool, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { SpanStatusCode, type Span } from '@opentelemetry/api';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { exceptionToSpan, logToSpan } from 'arvo-core';
import type { AgenticToolDefinition, IAgenticMCPClient } from '../types.js';

/**
 * Model Context Protocol (MCP) client implementation for connecting to and interacting with MCP servers.
 *
 * This client provides a robust interface for establishing connections to MCP servers,
 * discovering available tools, invoking those tools with arguments, and managing the
 * connection lifecycle. It supports both Server-Sent Events (SSE) and streamable HTTP
 * transport protocols, automatically selecting the appropriate transport based on the URL.
 */
export class MCPClient implements IAgenticMCPClient {
  private client: Client | null;
  private isConnected: boolean;
  private availableTools: Tool[];
  private readonly url: () => string;
  private readonly requestInit: () => RequestInit;

  constructor(url: string | (() => string), requestInit?: RequestInit | (() => RequestInit)) {
    this.client = null;
    this.isConnected = false;
    this.availableTools = [];
    this.url = typeof url === 'string' ? () => url : url;
    this.requestInit = !requestInit ? () => ({}) : typeof requestInit === 'function' ? requestInit : () => requestInit;
  }

  /**
   * Establishes a connection to the MCP server and discovers available tools.
   *
   * This method performs the following operations:
   * 1. Selects the appropriate transport (SSE or HTTP streaming) based on URL
   * 2. Creates and configures the MCP client with capabilities
   * 3. Establishes the connection to the server
   * 4. Retrieves and caches the list of available tools
   * 5. Logs all operations to the provided OpenTelemetry span
   *
   * @returns Promise that resolves when connection is established and tools are discovered
   * @throws {Error} Throws an error if connection fails, with details logged to the span
   */
  async connect(parentOtelSpan: Span) {
    try {
      const url = this.url();
      const requestInit = this.requestInit();
      const transport = url.includes('/mcp')
        ? new StreamableHTTPClientTransport(new URL(url), { requestInit })
        : new SSEClientTransport(new URL(url), { requestInit });
      this.client = new Client(
        {
          name: 'arvo-mcp-client',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
          },
        },
      );
      await this.client.connect(transport);
      logToSpan(
        {
          level: 'INFO',
          message: `Connected to MCP Server@${this.url}`,
        },
        parentOtelSpan,
      );
      const tools: ListToolsResult = await this.client.listTools();
      this.availableTools = tools.tools;
      this.isConnected = true;
      logToSpan(
        {
          level: 'INFO',
          message: 'Available MCP tools:',
          tools: JSON.stringify(this.availableTools.map((t: Tool) => ({ name: t.name, description: t.description }))),
        },
        parentOtelSpan,
      );
    } catch (error) {
      exceptionToSpan(error as Error, parentOtelSpan);
      parentOtelSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error)?.message,
      });
      this.isConnected = false;
      throw new Error(`Unable to conntect to the MCP Server@${this.url()}`);
    }
  }

  /**
   * Retrieves the list of available tool definitions from the connected MCP server.
   *
   * Transforms the cached MCP tools into the AgenticToolDefinition format required
   * by the agent system. This method returns an empty array if not connected.
   */
  async getToolDefinitions(parentOtelSpan: Span) {
    const toolDef: AgenticToolDefinition[] = [];
    if (!this.isConnected) return toolDef;
    for (const item of this.availableTools) {
      toolDef.push({
        name: item.name,
        description: item.description ?? '',
        input_schema: item.inputSchema,
      });
    }
    return toolDef;
  }

  /**
   * Invokes a specific tool on the MCP server with the provided arguments.
   *
   * This method sends a tool invocation request to the connected MCP server and
   * returns the result. All operations are logged to the OpenTelemetry span for
   * observability. If an error occurs during invocation, it returns an error message
   * rather than throwing, allowing the agent to handle tool failures gracefully.
   */
  async invokeTool(param: { toolName: string; toolArguments?: Record<string, unknown> | null }, parentOtelSpan: Span) {
    try {
      logToSpan(
        {
          level: 'INFO',
          message: `Invoking tool<${param.toolName}> with arguments on MCP Server@${this.url}`,
          param: JSON.stringify(param),
        },
        parentOtelSpan,
      );
      if (!this.isConnected || !this.client) {
        throw new Error(`MCP Server@${this.url} not connected`);
      }
      const result = await this.client.callTool({
        name: param.toolName,
        arguments: param.toolArguments ?? undefined,
      });
      return JSON.stringify(result);
    } catch (error) {
      const err = new Error(
        `Error occured while invoking MCP tool <${param.toolName}@${this.url}> -> ${(error as Error)?.message ?? 'Something went wrong'}`,
      );
      exceptionToSpan(err, parentOtelSpan);
      return err.message;
    }
  }

  /**
   * Gracefully disconnects from the MCP server and cleans up resources.
   *
   * This method safely closes the connection to the MCP server if one exists,
   * resets the connection state, and clears cached data. It's safe to call
   * multiple times - subsequent calls will be no-ops if already disconnected.
   */
  async disconnect(parentOtelSpan: Span) {
    if (this.client && this.isConnected) {
      await this.client.close();
      this.isConnected = false;
      this.client = null;
      logToSpan(
        {
          level: 'INFO',
          message: `Disconnected from MCP Server@${this.url}`,
        },
        parentOtelSpan,
      );
    } else {
      logToSpan(
        {
          level: 'INFO',
          message: `MCP Server@${this.url} already disconnected`,
        },
        parentOtelSpan,
      );
    }
  }
}
