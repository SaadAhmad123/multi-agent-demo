import { calculatorContract } from './calculator.handler.js';
import { cleanString } from 'arvo-core';
import { anthropicLLMCaller } from '../agentFactory/integrations/anthropic.js';
import { createAgenticResumableContract } from '../agentFactory/createAgenticResumable/contract.js';
import { createAgenticResumable } from '../agentFactory/createAgenticResumable/index.js';
import type { EventHandlerFactory, IMachineMemory } from 'arvo-event-handler';
import type { NonEmptyArray } from '../agentFactory/types.js';

export const calculatorAgentContract = createAgenticResumableContract({
  alias: 'aleej',
  name: 'calculator',
  uri: '#/agents/resumable/calculator',
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
}> = ({ memory, humanInteractionDomain }) =>
  createAgenticResumable({
    contract: calculatorAgentContract,
    systemPrompt: () =>
      cleanString(`
        You are a mathematics specialist solving problems from natural language.

        **Answer directly** if no calculations needed.

        **Execute immediately** for simple, single-step calculations (basic arithmetic, algebra, standard formulas, clear problems with obvious solution paths). Follow tool approval requirements.

        **For complex/multi-step/multi-problem requests:**
        1. Analyze problem and identify calculation phases
        2. Create solution plan (approach, formulas, sequence)
        3. **Critical:** Request plan approval via human interaction tool (never skip this)
        4. Execute calculations following tool approval requirements
        5. Return complete solution
      `),
    services: {
      calculatorHandler: calculatorContract.version('1.0.0'),
    },
    enableHumanInteraction: humanInteractionDomain ? { domains: humanInteractionDomain } : undefined,
    memory,
    llm: anthropicLLMCaller,
  });
