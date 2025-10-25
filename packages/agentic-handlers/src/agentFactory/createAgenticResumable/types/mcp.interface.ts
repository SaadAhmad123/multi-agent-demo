import type { Span } from '@opentelemetry/api';
import type { OpenTelemetryHeaders } from 'arvo-core';
import type { AgenticToolDefinition } from '../../AgentRunner/types.js';

export interface IMCPClient {
  /**
   * Establishes a connection to the MCP server.
   * Must be called before any tool invocations.
   */
  connect: (parentOtelSpan: Span, parentOtelHeaders: OpenTelemetryHeaders) => Promise<void>;

  /** Invokes a specific tool through the MCP protocol */
  invokeTool: (
    param: { toolName: string; toolArguments?: Record<string, unknown> | null },
    parentOtelSpan: Span,
    parentOtelHeaders: OpenTelemetryHeaders,
  ) => Promise<string>;

  /**
   * Gracefully disconnects from the MCP server.
   * Should be called before agent shutsdown.
   */
  disconnect: (parentOtelSpan: Span, parentOtelHeaders: OpenTelemetryHeaders) => Promise<void>;

  /**
   * Retrieves all available tool definitions from the MCP server.
   * Used to discover what tools are available for the agent to use.
   */
  getToolDefinitions: (
    parentOtelSpan: Span,
    parentOtelHeaders: OpenTelemetryHeaders,
  ) => Promise<AgenticToolDefinition[]>;
}
