import { ArvoDomain, setupArvoMachine, xstate } from 'arvo-event-handler';
import { essayBuilderWorkflowContract } from './contract.ts';
import { essayOutlineAgentContract } from '../essay-outline.agent.ts';
import { essayWriterAgentContract } from '../essay-writer.agent.ts';
import { humanApprovalContract } from '../human.approval.contract.ts';
import { ArvoErrorType } from 'arvo-core';
import { cleanString } from 'arvo-core';

export const machineV100 = setupArvoMachine({
  contracts: {
    self: essayBuilderWorkflowContract.version('1.0.0'),
    services: {
      essayOutlineAgent: essayOutlineAgentContract.version('1.0.0'),
      essayWriterAgent: essayWriterAgentContract.version('1.0.0'),
      humanApproval: humanApprovalContract.version('1.0.0'),
    },
  },
  types: {
    context: {} as {
      topic: string;
      instruction: string | null;
      outline: string | null;
      essay: string | null;
      errors: ArvoErrorType[];
      comment: string | null;
      // This is used to provide context for the agents/orchestrator called by
      // this orchestration so that they can return their responses with correct
      // context stitching
      currentSubject: string;
      totalExecutionUnits: number;
    },
  },

  actions: {
    accumulateExecutionUnits: xstate.assign({
      totalExecutionUnits: ({ event, context }) =>
        context.totalExecutionUnits + (event.executionunits ?? 0),
    }),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QFsCGBjAFgSwHZgDUBGABhIDoZ8AnVAFzAH0B7AVzoBs8wBiWAT1jlU1AG7NyzaumFU65OLFT9J7LvgXVqUgNokAuolAAHZrGx1szXEZAAPRADYiATnKkA7AFYATI5IeLl5EHkQANCD8iADMRI7kwT4uHikuRF4AHI5eAL45EWhY3MRklGA09ExsnNw8IuKS0rLl8orKqjUaENZgeoZIIKbmlta2DgjR0RSOQX4+Xr4kjj4RUQgAtD5E5I7RGURxACzRLiRZLnkFGDj4JRTUYACOrHB0jKjGxtqiqBw8YKJ5JhWGhcMJPt9fuRYKx0OhFH1bEMLFYbANxgcvB5yC5HBkPCRDj5DsE9h5Voh0tFyB5Di5ks5HB4-ClLiBCjdCKR7k8XrA3h8vswfn8AUCQagwYLIRxobD4bBYDoiP0TGYUaN0ZSiFNyNFDgbGVksckKRsiIcds5MkR5hlCY5nGyOcVuWUKgxGG1+HxBMIxBIpDJUHIFIr2gB3agWMDUTTaaiIgbIkZo0DjHxkbFxHyBWKE2n4s1EDI+Gl+LzRXNTTME3L5dnXV2lKixype8M++qBpohlphpQqKMxuPdfBJtXDVFjSkZDKWukkeYpLHBIlm9ZxamhDLRXwpUgkxx5Bu4ZgQOC2F23blI9WpmcbRwb+bbLa7w5zkuJY8N69cltyjbT1qnUMA7ynTV00QddIkQHw53cLxlgWfMvCWZ0mxvUoHmeV53ghYVfggjU03sRBMgXWI0nxWiMhcaJi2OchCX2ElDhLej9UwopsIoVtaE9b0SIfLUEHSfxyDnOdPx1Mg9jNdD3BLEgvCJWJvGZQ4eM5O54ykETpzE9JmMzKY8QyXxqOfOCJmibEXHoqzdkzEkfGiHTmwoMdwOTe8jOg8T9ikxJHPolwfCSDxGNszd3Kk0ICQ8fYZO8bSTyAA */
  id: 'machineV100',
  // Initialise the workflow context
  // Only, this context is preserved across
  // start-stop cycles
  context: ({ input }) => ({
    currentSubject: input.subject,
    topic: input.data.topic,
    instruction: input.data.instructions,
    essay: null,
    outline: null,
    comment: null,
    errors: [],
    totalExecutionUnits: 0,
  }),
  // Define the final response builder of the workflow
  output: ({ context }) => ({
    errors: context.errors,
    essay: context.essay,
    success: Boolean(context.errors.length),
    comment: context.comment ??
      (context.errors.length
        ? 'Worflow failed with errors'
        : 'Essay generated successfully'),
    __executionunits: context.totalExecutionUnits,
  }),

  initial: 'generate_outline',
  states: {
    generate_outline: {
      description: 'Use the essay outline agent to generate an essay outline',
      // Call this method(s) when this state is entered
      entry: xstate.emit(({ context }) => ({
        type: 'arvo.orc.agent.essay.outline',
        data: {
          parentSubject$$: context.currentSubject,
          message: cleanString(`
            Generate an essay outline for the following topic:
            "${context.topic}"
            Additional Instructions:
            ${context.instruction ?? 'None'}
          `),
        },
      })),

      // Declare the steps to take when a valid
      // response event is recieved
      on: {
        'sys.arvo.orc.agent.essay.outline.error': {
          // Go to the error state and append the error
          target: 'error',
          actions: xstate.assign({
            errors: ({ event, context }) => [...context.errors, event.data],
          }),
        },
        'arvo.orc.agent.essay.outline.done': {
          // Store the outline
          target: 'request_approval',
          actions: [
            xstate.assign({
              outline: ({ event }) => event.data.response,
            }),
            // Reference a common actions defined in setup
            'accumulateExecutionUnits',
          ],
        },
      },
    },

    request_approval: {
      description: 'Show the outline to a human and request their approval',
      entry: xstate.emit(({ context }) => ({
        type: 'com.human.approval',
        // Explicit domain declaration
        domain: [ArvoDomain.FROM_EVENT_CONTRACT],
        // Notice, that the human approval is not defined
        // as an orchestrator so no parentSubject$$ is needed.
        // This is because from this system's perspective,
        // then human approval is a request-response model
        // and the system does not care what happens during
        // the process.
        // For orchestrators, they emit events in the same
        // event plane of the system and that is why event
        // differentiation and correlation is needed by the
        // system to operate well.
        data: {
          prompt: cleanString(`
            For the topic "${context.topic}" following is the proposed outline:
            
            ${context.outline}

            Please review this and provide your approval
          `),
        },
      })),

      on: {
        // Here, xstates guard semantics is used,
        // For a single event, depending on its data
        // two paths are defined
        'evt.human.approval.success': [
          {
            description: 'If approval deined',
            // A guard clause is similar to an if statement
            guard: ({ event }) => !event.data.approval,
            target: 'error',
            actions: [
              xstate.assign({ comment: 'Human did not approve this outline' }),
              xstate.assign({
                errors: ({ context }) => [...context.errors, {
                  errorName: 'ApprovalRejection',
                  errorMessage: 'Human did not appove the outline',
                  errorStack: null,
                }],
              }),
            ],
          },
          {
            description: 'If approval granted',
            target: 'generate_essay',
          },
        ],
        // From the main.ts, it is apparent that there
        // will never be a system error event for this.
        // In the future, when the execution model
        // has the possibility of error event for this
        // then you can add the 'sys...error' path
        // as well
      },
    },
    generate_essay: {
      description: 'Use the essay writer agent to write the essay',
      entry: xstate.emit(({ context }) => ({
        type: 'arvo.orc.agent.essay.writer',
        data: {
          parentSubject$$: context.currentSubject,
          message: cleanString(`
            Can you write an essay for the topic "${context.topic}" 

            You must follow this outline exactly: 
            ${context.outline}

            Additional instructions: 
            ${context.instruction}
          `),
        },
      })),

      on: {
        'sys.arvo.orc.agent.essay.writer.error': {
          target: 'error',
          actions: xstate.assign({
            errors: ({ event, context }) => [...context.errors, event.data],
          }),
        },
        'arvo.orc.agent.essay.writer.done': {
          target: 'done',
          actions: [
            xstate.assign({ essay: ({ event }) => event.data.response }),
            'accumulateExecutionUnits',
          ],
        },
      },
    },

    // This final states mark terminal states in the
    // machine
    error: {
      type: 'final',
    },
    done: {
      type: 'final',
    },
  },
});
