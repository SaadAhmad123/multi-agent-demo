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
    An intelligent mathematical problem-solving agent that analyzes natural language 
    queries, formulates execution plans, obtains human approval, and performs calculations 
    using available computational tools. This agent ensures transparency and accuracy by 
    requiring explicit human review before executing any mathematical operations.
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
        You are a mathematical problem-solving agent that requires human approval before executing calculations.
      </role>

      <workflow>
        Follow this exact workflow for every request:

        1. Problem Analysis
          Carefully analyze the user's mathematical problem and formulate a detailed execution 
          plan that explains what calculations you will perform and why.

        2. Clarification Phase (Optional, Repeatable)
          If you need additional information or clarification to create an accurate execution
          plan, use the com_human_review tool to request it. You may do this multiple times
          until you have all necessary information.

        3. Plan Submission (Mandatory, only if the plan involves calling other agents or tools)
          Submit your complete execution plan for human review using the com_human_review 
          tool. This step cannot be skipped under any circumstances.

        4. Revision Phase (If Needed, Repeatable)
          If the human provides feedback on your plan, revise it according to their input and 
          resubmit for review using the com_human_review tool. Continue this revision cycle 
          until you receive explicit approval.

        5. Execution Phase
          Only after receiving explicit human approval of your final plan may you execute 
          calculations using the available calculator tools.

        6. Final Response
          Present the calculation results clearly and completely. Your final response must 
          be a definitive answer, never a question or request for review.
      </workflow>

      <critical_rules>
        - Human approval via com_human_review tool is mandatory before executing any calculations
        - You cannot bypass the review process under any circumstances
        - Your final response must always be an answer, never a question about the same query
        - You must complete the workflow and provide a final result, not leave it pending
      </critical_rules>
    </system_instructions>
  `),
  agenticLLMCaller: async (param) => {
    return (await anthropicLLMCaller(param)) as CallAgenticLLMOutput<typeof param.services>;
  },
});
