import { createAgenticResumable } from '../agentFactory/createAgenticResumable/index.dep.js';
import { anthropicLLMCaller } from '../agentFactory/integrations/anthropic.js';
import { cleanString } from 'arvo-core';
import { astroDocsMcpAgent } from './agent.mcp.astro.docs.js';
import { findDomainMcpAgent } from './agent.mcp.findadomain.js';
import { fetchWebMcpAgent } from './agent.mcp.fetch.web.js';
import { humanInteractionServiceDomain } from '../agentFactory/contracts/humanInteraction.contract.js';

/**
 * Web Information Agent implementation that demonstrates inter-agent
 * communication patterns within the system.
 *
 * This Agentic Resumable demonstrates the utilization of a unified configuration approach for
 * connecting with other agents, maintaining consistent integration patterns
 * whether interfacing with ArvoOrchestrators, ArvoResumables, ArvoEventHandlers or Arvo Agents.
 */
export const webInfoAgent = createAgenticResumable({
  alias: 'tom',
  name: 'web.info',
  description: cleanString(`
    A comprehensive web information orchestrator that coordinates three specialized capabilities: 
    domain research and availability checking, Astro framework documentation and guidance, and 
    general web content retrieval and analysis. This agent intelligently analyzes user queries 
    and delegates to the appropriate specialist, handling domain registration inquiries, Astro 
    development questions, web page content extraction, or any combination of these services 
    to provide complete, well-researched answers.
  `),
  systemPrompt: () =>
    cleanString(`
    <system_instructions>
      <role>
        You are a web information coordinator that routes queries to three specialized 
        agents: domain services, Astro documentation, and web content retrieval. You 
        can also engage with humans for clarification or approval when needed.
      </role>

      <workflow>
        Analyze the user's query to determine which specialist is needed. If the query 
        is ambiguous or you need clarification, use the com_human_review tool to ask 
        for more information. For complex queries requiring multiple agent calls or 
        significant research, create an execution plan and use com_human_review to get 
        approval before proceeding. Route domain questions to the domain agent, Astro 
        framework questions to the documentation agent, and web page analysis requests 
        to the content retrieval agent. For multi-faceted queries, coordinate responses 
        from multiple agents as needed.
      </workflow>

      <guidelines>
        Use com_human_review to request clarification when the query intent is unclear 
        or when you need additional information to provide an accurate answer. For 
        straightforward queries, proceed directly with the appropriate specialist agents. 
        For complex or multi-step queries, present your execution plan via com_human_review 
        and wait for approval before executing. Synthesize responses from agents into 
        coherent answers. Coordinate multiple agent calls when queries span multiple 
        areas of expertise.
      </guidelines>
    </system_instructions>
  `),
  services: {
    astroDocAgent: astroDocsMcpAgent.contract.version('1.0.0'),
    findDomainAgent: findDomainMcpAgent.contract.version('1.0.0'),
    fetchWebAgent: fetchWebMcpAgent.contract.version('1.0.0'),
  },
  humanInteraction: {
    require: true,
    domain: [humanInteractionServiceDomain],
  },
  agenticLLMCaller: anthropicLLMCaller,
});
