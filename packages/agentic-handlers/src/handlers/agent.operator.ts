import { cleanString } from 'arvo-core';
import { createAgenticResumable } from '../agentFactory/createAgenticResumable/index.js';
import { anthropicLLMCaller } from '../agentFactory/integrations/anthropic.js';
import { humanInteractionServiceDomain } from '../agentFactory/contracts/humanInteraction.contract.js';
import { calculatorAgent } from './agent.calculator.js';
import { astroDocsMcpAgent } from './agent.mcp.astro.docs.js';
import { findDomainMcpAgent } from './agent.mcp.findadomain.js';
import { webInfoAgent } from './agent.webinfo.js';
import { githubMcpAgent } from './agent.mcp.github.js';
import { zapierGoogleDocsMcpAgent } from './agent.mcp.zapier.googledocs.js';
import { zapierGmailAndWeatherMcpAgent } from './agent.mcp.zapier.gmailandweather.js';

export const operatorAgent = createAgenticResumable({
  alias: 'operator',
  name: 'operator',
  maxToolInteractions: 100,
  description: cleanString(`
    The primary orchestration agent that serves as the system coordinator, managing all 
    specialized peer agents. This operator analyzes user requests, discovers appropriate 
    specialists, formulates execution plans, obtains human approval, and coordinates multi-agent 
    workflows. While the operator handles general queries and complex multi-agent tasks, users 
    can achieve faster, more targeted results by directly engaging specialized agents for 
    domain-specific questions.
  `),
  systemPrompt: () =>
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
  services: {
    calculatorAgent: calculatorAgent.contract.version('1.0.0'),
    astroDocsMcpAgent: astroDocsMcpAgent.contract.version('1.0.0'),
    findDomainMcpAgent: findDomainMcpAgent.contract.version('1.0.0'),
    webInfoAgent: webInfoAgent.contract.version('1.0.0'),
    githubMcpAgent: githubMcpAgent.contract.version('1.0.0'),
    zapierGoogleDocsMcpAgent: zapierGoogleDocsMcpAgent.contract.version('1.0.0'),
    zapierGmailAndWeatherMcpAgent: zapierGmailAndWeatherMcpAgent.contract.version('1.0.0'),
  },
  humanInteraction: {
    require: true,
    domain: [humanInteractionServiceDomain],
  },
  toolUseApproval: {
    require: true,
    domain: [humanInteractionServiceDomain],
    tools: [zapierGoogleDocsMcpAgent.contract.version('1.0.0').accepts.type],
  },
  agenticLLMCaller: anthropicLLMCaller,
});
