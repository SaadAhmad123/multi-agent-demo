import { createArvoContract } from 'arvo-core';
import { createArvoEventHandler, type EventHandlerFactory } from 'arvo-event-handler';
import { z } from 'zod';

/**
 * Calculator event handler for mathematical operations that are
 * computationally intensive or difficult for agents to execute directly.
 *
 * This handler accepts JavaScript mathematical expressions and evaluates
 * them within a strictly sandboxed environment. Within the Arvo event-driven
 * architecture, this handler can be invoked by users, ArvoOrchestrators,
 * ArvoResumables, and Agentic ArvoResumables through the event broker.
 *
 * The toolUseId$$ passthrough field enables participation in agentic workflows
 * by providing the correlation identifier required by LLMs to track tool call
 * execution across the request-response cycle.
 */
export const calculatorContract = createArvoContract({
  uri: '#/amas/calculator/execute',
  type: 'com.calculator.execute',
  description: 'Executes mathematical expressions safely using a restricted evaluation environment.',
  versions: {
    '1.0.0': {
      accepts: z.object({
        expression: z
          .string()
          .describe(
            'Mathematical expression to evaluate. Supports: arithmetic operators (+, -, *, /, %, **), ' +
              'Math functions (sqrt, pow, sin, cos, tan, log, exp, abs, round, min, max, floor, ceil), ' +
              'and constants (PI, E). Examples: "2 + 2", "sqrt(16) * 5", "PI * pow(2, 3)", "sin(PI/2)"',
          ),
        // This is a usefull field when working with AI Agents for tool call correlation
        toolUseId$$: z.string().optional(),
      }),
      emits: {
        'evt.calculator.execute.success': z.object({
          result: z.number().describe('Computed result of the mathematical expression as a finite number.'),
          expression: z.string().describe('Original expression that was evaluated, returned for verification.'),
          // This is a usefull field when working with AI Agents for tool call correlation
          toolUseId$$: z.string().optional(),
        }),
      },
    },
  },
});

export const calculatorHandler: EventHandlerFactory = () =>
  createArvoEventHandler({
    contract: calculatorContract,
    executionunits: 0,
    handler: {
      '1.0.0': async ({ event }) => {
        const { expression, toolUseId$$ } = event.data;

        if (!expression || expression.trim().length === 0) {
          throw new Error('Expression cannot be empty');
        }

        try {
          const result = evaluateMathExpression(expression);

          if (typeof result !== 'number' || !Number.isFinite(result)) {
            throw new Error('Expression must evaluate to a finite number');
          }

          return {
            type: 'evt.calculator.execute.success',
            data: {
              result,
              expression,
              toolUseId$$,
            },
            executionunits: expression.length * 1e-6,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          throw new Error(`Failed to evaluate expression: ${message}`);
        }
      },
    },
  });

function evaluateMathExpression(expr: string): number {
  const whitelist = /^[0-9+\-*/().%\s,]+$/;

  const safeExpr = expr
    .replace(/\bPI\b/g, 'PI')
    .replace(/\bE\b/g, 'E')
    .replace(/\bsqrt\b/g, 'sqrt')
    .replace(/\bpow\b/g, 'pow')
    .replace(/\babs\b/g, 'abs')
    .replace(/\bsin\b/g, 'sin')
    .replace(/\bcos\b/g, 'cos')
    .replace(/\btan\b/g, 'tan')
    .replace(/\basin\b/g, 'asin')
    .replace(/\bacos\b/g, 'acos')
    .replace(/\batan\b/g, 'atan')
    .replace(/\blog\b/g, 'log')
    .replace(/\bexp\b/g, 'exp')
    .replace(/\bfloor\b/g, 'floor')
    .replace(/\bceil\b/g, 'ceil')
    .replace(/\bround\b/g, 'round')
    .replace(/\bmin\b/g, 'min')
    .replace(/\bmax\b/g, 'max');

  const testExpr = safeExpr.replace(
    /\b(sqrt|pow|abs|sin|cos|tan|asin|acos|atan|log|exp|floor|ceil|round|min|max|PI|E)\b/g,
    '',
  );

  if (!whitelist.test(testExpr)) {
    throw new Error('Expression contains invalid characters or functions');
  }

  const evalFunc = new Function(
    'sqrt',
    'pow',
    'abs',
    'sin',
    'cos',
    'tan',
    'asin',
    'acos',
    'atan',
    'log',
    'exp',
    'floor',
    'ceil',
    'round',
    'min',
    'max',
    'PI',
    'E',
    `"use strict"; return (${safeExpr});`,
  );

  return evalFunc(
    Math.sqrt,
    Math.pow,
    Math.abs,
    Math.sin,
    Math.cos,
    Math.tan,
    Math.asin,
    Math.acos,
    Math.atan,
    Math.log,
    Math.exp,
    Math.floor,
    Math.ceil,
    Math.round,
    Math.min,
    Math.max,
    Math.PI,
    Math.E,
  );
}
