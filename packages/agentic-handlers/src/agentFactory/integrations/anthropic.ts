import Anthropic from '@anthropic-ai/sdk';
import { SemanticConventions as OpenInferenceSemanticConventions } from '@arizeai/openinference-semantic-conventions';
import type { AgentLLMIntegration, AgentLLMIntegrationOutput } from '../AgentRunner/types.js';
import { tryParseJson } from './utils.jsonParse.js';
import { logToSpan } from 'arvo-core';

/** Anthropic Claude integration for agentic LLM calls within Arvo orchestrators. */
export const anthropicLLMCaller: AgentLLMIntegration = async (
  {
    messages,
    outputFormat,
    tools,
    systemPrompt,
    stream: eventStreamer,
    selfInformation: _selfInformation,
    delegatedBy,
  },
  { span },
) => {
  const { description, ...selfInformation } = _selfInformation;
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
  const toolDef: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> = [];
  for (const { name, description, input_schema } of tools) {
    toolDef.push({ name, description, input_schema });
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
      return c;
    }),
  }));

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    dangerouslyAllowBrowser: true,
  });

  // Use streaming API
  const stream = await anthropic.messages.create({
    model: llmModel,
    max_tokens: llmInvocationParams.maxTokens,
    temperature: llmInvocationParams.temperature,
    system: systemPrompt ?? undefined,
    // biome-ignore lint/suspicious/noExplicitAny: Any is fine here for now
    tools: toolDef as any,
    // biome-ignore lint/suspicious/noExplicitAny: Any is fine here for now
    messages: formattedMessages as any,
    stream: true,
  });

  /**
   * Process the stream and accumulate response data.
   * Extracts tool requests and text responses as they arrive.
   */
  const toolRequests: NonNullable<AgentLLMIntegrationOutput['toolRequests']> = [];
  let finalResponse = '';
  let stopReason: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  // Track tool use blocks being built
  const toolUseBlocks: Map<number, { id: string; name: string; input: string }> = new Map();

  for await (const event of stream) {
    if (event.type === 'message_start') {
      inputTokens = event.message.usage.input_tokens;
      outputTokens = event.message.usage.output_tokens;
    } else if (event.type === 'content_block_start') {
      if (event.content_block.type === 'tool_use') {
        toolUseBlocks.set(event.index, {
          id: event.content_block.id,
          name: event.content_block.name,
          input: '',
        });
      }
    } else if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') {
        finalResponse += event.delta.text;
        eventStreamer?.({
          type: 'llm.stream',
          data: {
            response: finalResponse,
            delta: event.delta.text,
            delegatedBy,
            selfInformation,
          },
        }).catch(() => {});
      } else if (event.delta.type === 'input_json_delta') {
        const block = toolUseBlocks.get(event.index);
        if (block) {
          block.input += event.delta.partial_json;
          eventStreamer?.({
            type: 'llm.stream',
            data: {
              response: `Preparing tool call ${block.name}`,
              delta: null,
              delegatedBy,
              selfInformation,
            },
          }).catch(() => {});
        }
      }
    } else if (event.type === 'content_block_stop') {
      const block = toolUseBlocks.get(event.index);
      if (block) {
        try {
          toolRequests.push({
            type: block.name,
            id: block.id,
            data: JSON.parse(block.input) as object,
          });
        } catch (e) {
          eventStreamer?.({
            type: 'llm.stream',
            data: {
              response: `Skipping tool call ${block.name} due to technical issues`,
              delta: null,
              delegatedBy,
              selfInformation,
            },
          }).catch(() => {});
          logToSpan(
            {
              level: 'WARNING',
              message: `Failed to parse tool call input for tool '${block.name}' (id: ${block.id}). Tool call will be dropped.`,
            },
            span,
          );
        }
        toolUseBlocks.delete(event.index);
      }
    } else if (event.type === 'message_delta') {
      stopReason = event.delta.stop_reason ?? stopReason;
      outputTokens += event.usage.output_tokens;
    }
  }

  const llmUsage: NonNullable<AgentLLMIntegrationOutput['usage']> = {
    tokens: {
      prompt: inputTokens,
      completion: outputTokens,
    },
  };

  if (toolRequests.length) {
    return {
      toolRequests,
      response: null,
      usage: llmUsage,
    };
  }

  // Handle response based on stop reason
  let processedResponse = finalResponse;
  if (stopReason === 'max_tokens' && finalResponse) {
    processedResponse = `${finalResponse}\n\n[Response truncated: Maximum token limit reached]`;
  } else if (!finalResponse && stopReason === 'max_tokens') {
    processedResponse = '[Response truncated: Maximum token limit reached]';
  }

  return {
    toolRequests: null,
    response: processedResponse
      ? outputFormat && tryParseJson(processedResponse)
        ? outputFormat.parse(JSON.parse(processedResponse))
        : processedResponse
      : '',
    usage: llmUsage,
  };
};
