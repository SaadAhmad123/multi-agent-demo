import OpenAI from 'openai';
import type {
  AgenticToolResultMessageContent,
  AgentLLMIntegration,
  AgentLLMIntegrationOutput,
  AgentLLMIntegrationParam,
} from '../AgentRunner/types.js';
import { SemanticConventions as OpenInferenceSemanticConventions } from '@arizeai/openinference-semantic-conventions';
import type { ChatModel } from 'openai/resources/shared.mjs';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/index.mjs';
import { tryParseJson } from './utils.jsonParse.js';
import { logToSpan } from 'arvo-core';

/**
 * Converts Arvo agentic messages to OpenAI-compatible chat completion format.
 *
 * Performs critical transformations required by OpenAI's API:
 * - Injects system prompts as developer role messages (OpenAI's preferred approach)
 * - Flattens Arvo's nested content arrays into individual messages
 * - Ensures tool calls are immediately followed by their results (strict OpenAI requirement)
 * - Maps agentic message types to OpenAI's schema while preserving conversation flow
 *
 * @param messages - Conversation history in agentic message format
 * @param systemPrompt - Optional system prompt to inject as developer message
 * @returns Array of OpenAI-compatible chat completion messages
 */
const formatMessagesForOpenAI = (
  messages: AgentLLMIntegrationParam['messages'],
  systemPrompt?: string,
): ChatCompletionMessageParam[] => {
  const formatedMessages: ChatCompletionMessageParam[] = [];

  // Inject system prompt as developer role (OpenAI's recommended approach)
  if (systemPrompt) {
    formatedMessages.push({
      role: 'developer',
      content: systemPrompt,
    });
  }

  const flattendMessages: {
    role: (typeof messages)[number]['role'];
    content: (typeof messages)[number]['content'][number];
  }[] = [];

  // OpenAI requires tool results to immediately follow their corresponding tool calls.
  // We build a map to efficiently pair tool calls with their results.
  const toolResponseMap: Record<string, AgenticToolResultMessageContent> = {};

  // Flatten nested content structure and build tool response mapping
  for (const rawMessage of messages) {
    for (const rawContent of rawMessage.content) {
      flattendMessages.push({
        role: rawMessage.role,
        content: rawContent,
      });
      if (rawContent.type === 'tool_result') {
        toolResponseMap[rawContent.tool_use_id] = rawContent;
      }
    }
  }

  // Convert to OpenAI format while maintaining proper message sequencing
  for (const item of flattendMessages) {
    // A user can only have text content or tool results
    if (item.role === 'user') {
      if (item.content.type === 'text') {
        formatedMessages.push({
          role: 'user',
          content: item.content.content,
        });
      }
    }
    // Handle assistant messages (text responses and tool calls)
    if (item.role === 'assistant') {
      if (item.content.type === 'text') {
        formatedMessages.push({
          role: 'assistant',
          content: item.content.content,
        });
      }
      if (item.content.type === 'tool_use') {
        formatedMessages.push({
          role: 'assistant',
          tool_calls: [
            {
              type: 'function',
              id: item.content.id,
              function: {
                name: item.content.name,
                arguments: JSON.stringify(item.content.input),
              },
            },
          ],
        });
        // Immediately add the corresponding tool result (OpenAI requirement)
        formatedMessages.push({
          role: 'tool',
          tool_call_id: item.content.id,
          content: JSON.stringify(toolResponseMap[item.content.id] ?? { error: 'No tool response' }),
        });
      }
    }
  }

  return formatedMessages;
};

/**
 * OpenAI ChatGPT integration for agentic LLM calls within Arvo orchestrators.
 *
 * Bridges Arvo's contract-based event system with OpenAI's GPT models, enabling
 * AI agents to make intelligent tool decisions and generate responses within Arvo's
 * event-driven architecture. Handles the complex message formatting and tool
 * conversion required for OpenAI's API while maintaining Arvo's type safety.
 *
 * ## OpenAI-Specific Handling
 * - Tool calls must be immediately followed by their results in message history
 * - Function names cannot contain dots, requiring automatic name conversion
 * - System prompts are injected as developer role messages for better adherence
 *
 * @returns Promise resolving to structured LLM output with either
 * a direct text response or tool requests
 *
 * @throws {Error} If OpenAI provides neither a response nor tool requests
 */
export const openaiLLMCaller: AgentLLMIntegration = async (
  {
    messages,
    tools,
    systemPrompt,
    outputFormat,
    stream: eventStreamer,
    selfInformation: _selfInformation,
    delegatedBy,
  },
  { span },
) => {
  const { description, ...selfInformation } = _selfInformation;
  /**
   * Configure model and invocation parameters.
   */
  const llmModel: ChatModel = 'gpt-4o';
  const llmInvocationParams = {
    temperature: 0.5,
    maxTokens: 4096,
  };

  // Configure OpenTelemetry attributes for observability
  span.setAttributes({
    [OpenInferenceSemanticConventions.LLM_PROVIDER]: 'openai',
    [OpenInferenceSemanticConventions.LLM_SYSTEM]: 'openai',
    [OpenInferenceSemanticConventions.LLM_MODEL_NAME]: llmModel,
    [OpenInferenceSemanticConventions.LLM_INVOCATION_PARAMETERS]: JSON.stringify({
      temperature: llmInvocationParams.temperature,
      max_tokens: llmInvocationParams.maxTokens,
    }),
  });

  // Convert tool definitions to OpenAI function format
  const toolDef: ChatCompletionTool[] = [];
  for (const item of tools) {
    toolDef.push({
      type: 'function',
      function: {
        name: item.name,
        description: item.description,
        parameters: item.input_schema,
      },
    } as ChatCompletionTool);
  }

  // Format conversation history for OpenAI's specific requirements
  const formattedMessages = formatMessagesForOpenAI(messages, systemPrompt ?? undefined);

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    dangerouslyAllowBrowser: true,
  });

  // Use streaming API
  const stream = await openai.chat.completions.create({
    model: llmModel,
    max_tokens: llmInvocationParams.maxTokens,
    temperature: llmInvocationParams.temperature,
    tools: toolDef,
    messages: formattedMessages,
    stream: true,
  });

  /**
   * Process the stream and accumulate response data.
   * Extracts tool requests and text responses as they arrive.
   */
  const toolRequests: NonNullable<AgentLLMIntegrationOutput['toolRequests']> = [];
  let finalResponse = '';
  let finishReason: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  // Track tool calls being built incrementally
  const toolCallsMap: Map<
    number,
    {
      id: string;
      name: string;
      arguments: string;
    }
  > = new Map();

  for await (const chunk of stream) {
    const choice = chunk.choices[0];

    if (!choice) continue;

    // Accumulate text deltas
    if (choice.delta?.content) {
      finalResponse += choice.delta.content;
      eventStreamer?.({
        type: 'llm.stream',
        data: {
          response: finalResponse,
          delta: choice.delta.content,
          delegatedBy,
          selfInformation,
        },
      }).catch(() => {});
    }

    // Handle tool call deltas
    if (choice.delta?.tool_calls) {
      for (const toolCall of choice.delta.tool_calls) {
        const index = toolCall.index;

        if (!toolCallsMap.has(index)) {
          toolCallsMap.set(index, {
            id: toolCall.id || '',
            name: toolCall.function?.name || '',
            arguments: '',
          });
        }

        // biome-ignore lint/style/noNonNullAssertion: This cannot be null as if it does not exist it is filled by above statement
        const existingCall = toolCallsMap.get(index)!;

        if (toolCall.id) {
          existingCall.id = toolCall.id;
        }
        if (toolCall.function?.name) {
          existingCall.name = toolCall.function.name;
          eventStreamer?.({
            type: 'llm.stream',
            data: {
              response: `Preparing tool call ${existingCall.name}`,
              delta: null,
              delegatedBy,
              selfInformation,
            },
          }).catch(() => {});
        }
        if (toolCall.function?.arguments) {
          existingCall.arguments += toolCall.function.arguments;
        }
      }
    }

    // Capture finish reason and usage data
    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }

    // OpenAI provides usage in the final chunk
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens;
      outputTokens = chunk.usage.completion_tokens;
    }
  }

  // Process completed tool calls
  for (const [_, toolCall] of toolCallsMap) {
    try {
      toolRequests.push({
        type: toolCall.name,
        id: toolCall.id,
        data: JSON.parse(toolCall.arguments) as object,
      });
    } catch (e) {
      eventStreamer?.({
        type: 'llm.stream',
        data: {
          response: `Skipping tool call ${toolCall.name} due to technical issues`,
          delta: null,
          delegatedBy,
          selfInformation,
        },
      }).catch(() => {});
      logToSpan(
        {
          level: 'WARNING',
          message: `Failed to parse tool call arguments for tool '${toolCall.name}' (id: ${toolCall.id}). Tool call will be dropped.`,
        },
        span,
      );
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

  // Handle response based on finish reason
  let processedResponse = finalResponse;
  if (finishReason === 'length' && finalResponse) {
    processedResponse = `${finalResponse}\n\n[Response truncated: Maximum token limit reached]`;
  } else if (!finalResponse && finishReason === 'length') {
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
