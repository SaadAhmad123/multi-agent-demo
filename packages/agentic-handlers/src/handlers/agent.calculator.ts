import { calculatorContract } from './calculator.handler.js';
import { cleanString } from 'arvo-core';
import { anthropicLLMCaller } from '../agentFactory/integrations/anthropic.js';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import { createAgentContract } from '../agentFactory/createAgent/contract.js';
import type { NonEmptyArray } from '../agentFactory/createAgent/types.js';
import { AgentRunner } from '../agentFactory/AgentRunner/index.js';
import { createAgent } from '../agentFactory/createAgent/resumable.js';
import { withDefaultContextBuilder } from '../agentFactory/prompts.js';

export const calculatorAgentContract = createAgentContract({
  alias: 'aleej',
  name: 'calculator',
  uri: '#/agents/calculator',
  description: cleanString(`
    Solves mathematical problems from natural language. Handles arithmetic, algebra,
    and complex calculations.
  `),
});

/**
 * Calculator agent that interprets natural language math problems and executes
 * computations with human oversight for accuracy and auditability.
 */
export const calculatorAgent: EventHandlerFactory<{
  memory: IMachineMemory<Record<string, unknown>>;
  humanInteractionDomain?: NonEmptyArray<string>;
}> = ({ memory, humanInteractionDomain }) => {
  const engine = new AgentRunner({
    name: calculatorAgentContract.type,
    llm: anthropicLLMCaller,
    maxToolInteractions: 10,
    contextBuilder: withDefaultContextBuilder(
      cleanString(`
        You are a mathematics specialist solving problems from natural language.
        **Answer directly** if no calculations needed.
        **Execute immediately** for simple, single-step calculations (basic arithmetic, algebra, standard formulas, clear problems with obvious solution paths).
        **For complex/multi-step/multi-problem requests:**
        1. Analyze problem and identify calculation phases
        2. Create solution plan (approach, formulas, sequence)
        3. **Critical:** Request plan approval via human interaction tool (never skip this)
        4. Execute calculations following tool approval requirements
        5. Return complete solution
        # Important
        - Always show your work and explain your reasoning
        - For multi-step problems, break down the solution clearly
        - Verify your calculations before returning final results
      `),
    ),
  });

  return createAgent({
    contract: calculatorAgentContract,
    engine,
    memory,
    services: {
      calculatorHandler: calculatorContract.version('1.0.0'),
    },
    humanReview: humanInteractionDomain
      ? {
          domains: humanInteractionDomain,
        }
      : undefined,
  });
};
