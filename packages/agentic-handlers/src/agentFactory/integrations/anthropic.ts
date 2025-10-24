import Anthropic from '@anthropic-ai/sdk';
import { SemanticConventions as OpenInferenceSemanticConventions } from '@arizeai/openinference-semantic-conventions';
import type { AgenticToolDefinition, LLMIntegrationOutput, LLMIntergration } from '../createAgenticResumable/types.js';
import { createAgentToolNameStringFormatter } from '../createAgenticResumable/utils/index.js';
import { tryParseJson } from './utils/jsonParse.js';

/**
 * Anthropic Claude integration for agentic LLM calls within Arvo orchestrators.
 *
 * Bridges Arvo's contract-based event system with Anthropic's Claude API, enabling
 * AI agents to make intelligent tool decisions and generate responses within Arvo's
 * event-driven architecture. Handles message formatting, tool name conversion, and
 * response parsing for seamless integration.
 *
 * ## Tool Name Conversion
 * Arvo event types use dot notation (e.g., 'user.lookup') but Anthropic requires
 * underscore format (e.g., 'user_lookup'). This function handles the conversion
 * automatically while preserving the original semantics.
 *
 * @returns Promise resolving to structured LLM response with either text response or tool requests
 *
 * @throws {Error} When Claude provides neither a response nor tool requests
 */
export const anthropicLLMCaller: LLMIntergration = async ({
  messages,
  outputFormat,
  toolDefinitions,
  systemPrompt,
  span,
}) => {
  const llmModel: Anthropic.Messages.Model = 'claude-sonnet-4-0';
  const llmInvocationParams = {
    temperature: 0.5,
    maxTokens: 4096,
  };

  // Configure OpenTelemetry attributes for observability
  span.setAttributes({
    [OpenInferenceSemanticConventions.LLM_PROVIDER]: 'anthropic',
    [OpenInferenceSemanticConventions.LLM_SYSTEM]: 'anthropic',
    [OpenInferenceSemanticConventions.LLM_MODEL_NAME]: llmModel,
    [OpenInferenceSemanticConventions.LLM_INVOCATION_PARAMETERS]: JSON.stringify({
      temperature: llmInvocationParams.temperature,
      max_tokens: llmInvocationParams.maxTokens,
    }),
  });

  // Convert tool names to Anthropic-compatible format
  const toolDef: AgenticToolDefinition[] = [];
  const toolNameFormatter = createAgentToolNameStringFormatter();
  for (const item of toolDefinitions) {
    toolDef.push({ ...item, name: toolNameFormatter.format(item.name) });
  }

  /**
   * Converts agentic message format to Anthropic's expected structure.
   * Maps content types and ensures tool names are properly formatted.
   */
  const formattedMessages = messages.map((item) => ({
    ...item,
    content: item.content.map((c) => {
      if (c.type === 'text') {
        return {
          type: c.type,
          text: c.content,
        };
      }
      if (c.type === 'tool_use') {
        return {
          ...c,
          name: toolNameFormatter.format(c.name),
        };
      }
      return c;
    }),
  }));

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    dangerouslyAllowBrowser: true,
  });

  const message = await anthropic.messages.create({
    model: llmModel,
    max_tokens: llmInvocationParams.maxTokens,
    temperature: llmInvocationParams.temperature,
    system: systemPrompt ?? undefined,
    // biome-ignore lint/suspicious/noExplicitAny: Any is fine here for now
    tools: toolDef as any,
    // biome-ignore lint/suspicious/noExplicitAny: Any is fine here for now
    messages: formattedMessages as any,
  });

  /**
   * Extracts and processes tool requests from Claude's response.
   * Converts tool names back to Arvo format and tracks usage counts.
   */
  const toolRequests: NonNullable<LLMIntegrationOutput['toolRequests']> = [];
  const toolTypeCount: Record<string, number> = {};

  if (message.stop_reason === 'tool_use') {
    for (const item of message.content) {
      if (item.type === 'tool_use') {
        const actualType = toolNameFormatter.reverse(item.name) ?? item.name; // The system understands the original tool name no the AI tool name
        toolRequests.push({
          type: actualType,
          id: item.id,
          data: item.input as unknown as object,
        });
        // Track tool usage for workflow management
        if (!toolTypeCount[actualType]) {
          toolTypeCount[actualType] = 0;
        }
        toolTypeCount[actualType] = toolTypeCount[actualType] + 1;
      }
    }
  }

  /**
   * Extracts direct text response when Claude doesn't request tools.
   * Handles structured output parsing if an output format is specified.
   */
  let finalResponse: string | null = null;
  if (message.stop_reason === 'end_turn') {
    finalResponse = message.content[0]?.type === 'text' ? message.content[0].text : 'No final response';
  }
  if (message.stop_reason === 'max_tokens') {
    finalResponse =
      message.content[0]?.type === 'text'
        ? `${message.content[0].text}\n\n[Response truncated: Maximum token limit reached]`
        : '[Response truncated: Maximum token limit reached]';
  }

  // Structure response according to Arvo's agentic LLM output format
  const data: LLMIntegrationOutput = {
    toolRequests: toolRequests.length ? toolRequests : null,
    response: finalResponse
      ? outputFormat && tryParseJson(finalResponse)
        ? outputFormat.parse(JSON.parse(finalResponse))
        : finalResponse
      : null,
    toolTypeCount,
    usage: {
      tokens: {
        prompt: message.usage.input_tokens,
        completion: message.usage.output_tokens,
      },
    },
  };

  // Validate that Claude provided a usable response
  if (!data.response && !data.toolRequests) {
    data.response = 'Something went wrong. Unable to generate response or tool request. You can retry if you want';
  }

  return data;
};
