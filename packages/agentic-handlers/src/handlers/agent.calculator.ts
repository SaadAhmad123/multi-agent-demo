import { createAgenticResumable } from '../agentFactory/createAgenticResumable.js';
import { anthropicLLMCaller } from '../agentFactory/integrations/anthropic.js';
import type { CallAgenticLLMOutput } from '../agentFactory/types.js';
import { calculatorContract } from './calculator.handler.js';
import { humanReviewContract, humanReviewServiceDomain } from './human.review.js';
import { cleanString } from 'arvo-core';

/**
 * Calculator agent implementation that processes natural language input
 * and executes mathematical operations when feasible.
 *
 * This handler demonstrates the Agentic Resumable pattern's capability
 * to interface with arbitrary Arvo Event Handlers and orchestrate their
 * operations through a unified agentic interface.
 */
export const calculatorAgent = createAgenticResumable({
  name: 'calculator',
  description: cleanString(`
    A transparent, human approval-based math agent that interprets natural language problems,
    drafts a calculation plan, gets human approval, and then executes computations.
    It ensures accuracy, auditability, and efficiency by always routing plans
    through human review before performing any calculation.
  `),
  services: {
    calculatorHandler: calculatorContract.version('1.0.0'),
    humanReview: humanReviewContract.version('1.0.0'),
  },
  serviceDomains: {
    'com.human.review': [humanReviewServiceDomain],
  },
  systemPrompt: () =>
    cleanString(`
    <system_instructions>
      <role>
        You are a math problem-solving agent that must get human approval before any calculation.
      </role>

      <workflow>
        1. **Analyze** — Understand the math query and outline a precise calculation plan.
        2. **Clarify (optional)** — If needed, use com_human_review to request missing info.
        3. **Submit Plan** — Send the plan to com_human_review for mandatory approval.
        4. **Revise (if required)** — Update and resubmit until approved.
        5. **Execute** — Once approved, perform the calculation using calculator tools.
        6. **Respond** — Present only the tool's official output as the final answer.
      </workflow>

      <rules>
        - Human approval (via com_human_review) is required before any execution.
        - Never bypass the review process.
        - Return only the verified tool output — no inferred or partial steps.
        - Do not expand or guess intermediate results.
        - Provide a single, definitive numeric result, not a question or narrative.
        - Complete all workflow steps; do not leave pending reviews.
        - Parallelize computations for efficiency when possible.
        - You may call calculator tools in parallel (if needed) to improve efficiency.
        - No need to tell the human how you called or will call the tools.
      </rules>
    </system_instructions>
  `),
  agenticLLMCaller: async (param) => {
    return (await anthropicLLMCaller(param)) as CallAgenticLLMOutput<typeof param.services>;
  },
});
