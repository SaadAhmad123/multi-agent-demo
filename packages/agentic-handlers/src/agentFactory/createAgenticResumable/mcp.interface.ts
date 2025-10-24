import type { Span } from '@opentelemetry/api';
import type { OpenTelemetryHeaders } from 'arvo-core';
import type { AgenticToolDefinition } from './types.js';

/**
 * Interface for Model Context Protocol (MCP) client implementations.
 * Provides methods for managing MCP server connections and invoking tools.
 */
export interface IAgenticMCPClient {
  /**
   * Establishes a connection to the MCP server.
   * Must be called before any tool invocations.
   * @returns Promise that resolves when connection is established
   * @throws {Error} If connection to MCP server fails and you want to emit a system error event
   * @throws {ViolationError} If connection to MCP server fails and you want to throw an error you want to customer handle
   */
  connect: (parentOtelSpan: Span, parentOtelHeaders: OpenTelemetryHeaders) => Promise<void>;

  /**
   * Invokes a specific tool through the MCP protocol.
   *
   * @param param - Tool invocation parameters
   * @param parentOtelSpan - OpenTelemetry span for tracing the tool invocation
   * @returns Promise resolving to the tool's response as a string
   */
  invokeTool: (
    param: { toolName: string; toolArguments?: Record<string, unknown> | null },
    parentOtelSpan: Span,
    parentOtelHeaders: OpenTelemetryHeaders,
  ) => Promise<string>;

  /**
   * Gracefully disconnects from the MCP server.
   * Should be called before agent shutsdown.
   *
   * @param parentOtelSpan - OpenTelemetry span for tracing the disconnection operation
   * @returns Promise that resolves when disconnection is complete
   */
  disconnect: (parentOtelSpan: Span, parentOtelHeaders: OpenTelemetryHeaders) => Promise<void>;

  /**
   * Retrieves all available tool definitions from the MCP server.
   * Used to discover what tools are available for the agent to use.
   *
   * @param parentOtelSpan - OpenTelemetry span for tracing the discovery operation
   */
  getToolDefinitions: (
    parentOtelSpan: Span,
    parentOtelHeaders: OpenTelemetryHeaders,
  ) => Promise<AgenticToolDefinition[]>;
}
