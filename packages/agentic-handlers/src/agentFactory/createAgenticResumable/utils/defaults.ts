import z from 'zod';

/**
 * Default output format for agents that don't specify a custom output schema.
 * Provides a simple string response format for basic conversational agents.
 */
export const DEFAULT_AGENT_OUTPUT_FORMAT = z.object({ response: z.string() });
export const DEFAULT_AGENT_MAX_TOOL_INTERACTIONS = 5;
