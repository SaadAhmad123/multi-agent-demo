import { createAgenticResumable } from '../agentFactory/createAgenticResumable.js';
import { anthropicLLMCaller } from '../agentFactory/integrations/anthropic.js';
import { calculatorContract } from './calculator.handler.js';
import { humanReviewServiceDomain } from '../agentFactory/humanReview.contract.js';
import { cleanString } from 'arvo-core';

/**
 * Calculator agent that interprets natural language math problems and executes
 * computations with human oversight for accuracy and auditability.
 */
export const calculatorAgent = createAgenticResumable({
  alias: 'aleej',
  name: 'calculator',
  description: cleanString(`
    Solves mathematical problems from natural language. Handles arithmetic, algebra,
    calculus, and complex calculations.
  `),
  services: {
    calculatorHandler: calculatorContract.version('1.0.0'),
  },
  humanReview: {
    require: true,
    domain: [humanReviewServiceDomain],
  },
  systemPrompt: () =>
    cleanString(`
      You solve math problems accurately and efficiently.
      
      ## Workflow
      
      1. Parse the problem and identify required calculations
      2. If information is missing, clarify with the user
      3. Execute calculations using calculator tools
      4. Return the numeric result
      
      ## Rules
      
      - Return only the final result, not intermediate steps
      - Use parallel tool calls for independent calculations
      - Show calculation structure only if explicitly asked
      - Provide exact fractions when possible, decimals when requested
    `),
  agenticLLMCaller: anthropicLLMCaller,
});
