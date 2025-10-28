import { cleanString } from 'arvo-core';
import { anthropicLLMCaller } from '../agentFactory/integrations/anthropic.js';
import { calculatorAgentContract } from './agent.calculator.js';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import type { NonEmptyArray } from '../agentFactory/createAgent/types.js';
import { withDefaultContextBuilder } from '../agentFactory/createAgent/prompts.js';
import { createAgentContract } from '../agentFactory/createAgent/contract.js';
import { createAgent } from '../agentFactory/createAgent/resumable.js';
import { AgentRunner } from '../agentFactory/AgentRunner/index.js';
import { astroDocsMcpAgentContract } from './agent.mcp.astro.docs.js';
import { fetchWebMcpAgentContract } from './agent.mcp.fetch.web.js';
import { findDomainMcpAgentContract } from './agent.mcp.findadomain.js';
import { githubMcpAgentContract } from './agent.mcp.github.js';
import { zapierGmailAndWeatherMcpAgentContract } from './agent.mcp.zapier.gmailandweather.js';
import { zapierGoogleDocsMcpAgentContract } from './agent.mcp.zapier.googledocs.js';

export const operatorAgentContract = createAgentContract({
  alias: 'operator',
  name: 'operator',
  uri: '#/agents/operator',
  description: cleanString(`
    The primary orchestration agent that serves as the system coordinator, managing all 
    specialized peer agents. This operator analyzes user requests, discovers appropriate 
    specialists, formulates execution plans, obtains human approval, and coordinates multi-agent 
    workflows. While the operator handles general queries and complex multi-agent tasks, users 
    can achieve faster, more targeted results by directly engaging specialized agents for 
    domain-specific questions.
  `),
});

/**
 * Operator agent that orchestrates specialized agents and manages multi-agent workflows.
 * Serves as the primary coordinator for complex, cross-domain tasks requiring multiple specialists.
 */
export const operatorAgent: EventHandlerFactory<{
  memory: IMachineMemory<Record<string, unknown>>;
  humanInteractionDomain?: NonEmptyArray<string>;
}> = ({ memory, humanInteractionDomain }) => {
  const engine = new AgentRunner({
    name: operatorAgentContract.type,
    llm: anthropicLLMCaller,
    maxToolInteractions: 100,
    contextBuilder: withDefaultContextBuilder(
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
        
        # Available Specialists
        
        You can delegate tasks to the following specialist agents:
        - Calculator Agent: For mathematical problems, computations, and numerical analysis
        
        When delegating to specialists, provide clear context and instructions so they can 
        deliver complete solutions without back-and-forth.
      `),
    ),
  });

  return createAgent({
    contract: operatorAgentContract,
    engine,
    memory,
    services: {
      calculatorAgent: {
        contract: calculatorAgentContract.version('1.0.0'),
        approval: true,
      },
      astroDocsMcpAgent: astroDocsMcpAgentContract.version('1.0.0'),
      fetchWebMcpAgent: fetchWebMcpAgentContract.version('1.0.0'),
      findDomainMcpAgent: findDomainMcpAgentContract.version('1.0.0'),
      githubMcpAgent: githubMcpAgentContract.version('1.0.0'),
      zapierGmailAndWeatherMcpAgent: zapierGmailAndWeatherMcpAgentContract.version('1.0.0'),
      zapierGoogleDocsMcpAgent: zapierGoogleDocsMcpAgentContract.version('1.0.0'),
    },
    humanReview: humanInteractionDomain
      ? {
          domains: humanInteractionDomain,
        }
      : undefined,
  });
};
