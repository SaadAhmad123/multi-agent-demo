import { cleanString } from 'arvo-core';
import { anthropicLLMCaller } from '../agentFactory/integrations/anthropic.js';
import { calculatorAgentContract } from './agent.calculator.js';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import type { NonEmptyArray } from '../agentFactory/types.js';
import { withDefaultSystemPrompt } from '../agentFactory/createAgenticResumable/utils/prompts.js';
import { createAgenticResumableContract } from '../agentFactory/createAgenticResumable/create.contract.js';
import { createAgenticResumable } from '../agentFactory/createAgenticResumable/create.resumable.js';

export const operatorAgentContract = createAgenticResumableContract({
  alias: 'operator',
  name: 'operator',
  uri: '#/agents/resumable/operator',
  description: cleanString(`
    The primary orchestration agent that serves as the system coordinator, managing all 
    specialized peer agents. This operator analyzes user requests, discovers appropriate 
    specialists, formulates execution plans, obtains human approval, and coordinates multi-agent 
    workflows. While the operator handles general queries and complex multi-agent tasks, users 
    can achieve faster, more targeted results by directly engaging specialized agents for 
    domain-specific questions.
  `),
});

export const operatorAgent: EventHandlerFactory<{
  memory: IMachineMemory<Record<string, unknown>>;
  humanInteractionDomain?: NonEmptyArray<string>;
}> = ({ memory, humanInteractionDomain }) =>
  createAgenticResumable({
    contract: operatorAgentContract,
    maxToolInteractions: 100,
    systemPrompt: withDefaultSystemPrompt(
      cleanString(`
        You are the system orchestrator managing specialized agents. Users can reach you 
        or contact specialists directly for domain-specific needs.

        # Response Strategy

        **Answer Directly** when you can respond from knowledge without tools/agents.

        **Orchestrate** when the request needs agents, tools, or cross-domain coordination:
        1. Determine required capabilities and which specialists can provide them
        2. If unclear: ask clarifying questions to understand the complete requirement
        3. Create execution plan: specify agents/tools, sequence, and rationale
        4. Get plan approval before executing
        5. Execute: follow all approval requirements for each tool/agent as you call them
        6. Synthesize results into a complete answer

        # Orchestration Principles

        - Always follow the approval workflow for tools and agents as specified
        - Choose the right specialist for each capability need
        - Coordinate multiple agents when comprehensive coverage requires it
        - Iterate on plans when feedback indicates better approaches
        - Deliver complete answers, not status updates or follow-up questions
      `),
    ),
    services: {
      calculatorAgent: {
        contract: calculatorAgentContract.version('1.0.0'),
        approval: true,
      },
    },
    enableHumanInteraction: humanInteractionDomain ? { domains: humanInteractionDomain } : undefined,
    enableToolApproval: humanInteractionDomain ? { domains: humanInteractionDomain } : undefined,
    memory,
    llm: anthropicLLMCaller,
  });
