import type { ArvoEvent } from 'arvo-core';
import { SimpleMachineMemory } from 'arvo-event-handler';
import { telemetrySdkStart, telemetrySdkStop } from './otel.js';
import { checkbox, input } from '@inquirer/prompts';
import { requestProcessor } from './requestProcessor.js';
import { processSlashCommands } from './slashCommands.js';
import {
  displayAgentResponse,
  displayHumanReviewPrompt,
  displaySystemMessage,
  displayWelcomeBanner,
} from './ui/index.js';
import chalk from 'chalk';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  telemetrySdkStart();
  displayWelcomeBanner();

  const memory = new SimpleMachineMemory();
  let toolApprovalEvent: ArvoEvent | null = null;
  let toolApprovalList: string[] = [];
  let toolApprovalMessage = '';
  let humanReviewEvent: ArvoEvent | null = null;
  let currentAgentName: string | null = null;

  while (true) {
    let message = '';
    const toolApprovalMap: Record<string, boolean> = {};

    if (toolApprovalEvent) {
      console.log(chalk.green(`@${currentAgentName}:`));
      const answers = await checkbox({
        message: `${toolApprovalMessage}\n\nRequesting approval for the following tools:`,
        choices: toolApprovalList,
      });
      for (const item of toolApprovalList) {
        toolApprovalMap[item] = answers.includes(item);
      }
    } else {
      message = await input({
        message: humanReviewEvent ? 'Your response' : 'You',
        theme: {
          prefix: chalk.cyan('►'),
        },
      });

      if (!message.trim()) {
        continue;
      }

      const slashCommandResponse = processSlashCommands(message);

      if (slashCommandResponse?.type === '_EXIT') {
        displaySystemMessage(slashCommandResponse.data, 'info');
        break;
      }

      if (slashCommandResponse?.type === '_INFO') {
        displaySystemMessage(slashCommandResponse.data, 'info');
        continue;
      }
    }

    // Show processing indicator
    process.stdout.write(chalk.gray('  thinking... '));

    const result = await requestProcessor({
      message: message,
      memory: memory,
      ...(humanReviewEvent
        ? { isHumanReview: true, humanReviewRequestEvent: humanReviewEvent }
        : { isHumanReview: false }),
      ...(toolApprovalEvent
        ? { isToolApproval: true, toolApprovalRequestEvent: toolApprovalEvent, toolApprovalMap: toolApprovalMap }
        : { isToolApproval: false }),
    });

    humanReviewEvent = null;
    toolApprovalEvent = null;

    // Clear processing indicator
    process.stdout.write('\r\x1b[K');

    if (result.type === '_EXIT') {
      displaySystemMessage(result.data, 'error');
      break;
    }

    if (result.type === '_INFO') {
      displaySystemMessage(result.data, 'warning');
      continue;
    }

    if (result.type === '_HUMAN_REVIEW_REQUESTED') {
      humanReviewEvent = result.event as unknown as ArvoEvent;
      currentAgentName = result.agentName || currentAgentName;
      displayHumanReviewPrompt(result.data, currentAgentName);
    } else if (result.type === '_HUMAN_TOOL_USE_APPROVAL_REQUESTED') {
      toolApprovalEvent = result.event as unknown as ArvoEvent;
      currentAgentName = result.agentName || currentAgentName;
      toolApprovalList = result.toolRequestedForApproval;
      toolApprovalMessage = result.data;
    } else if (result.type === '_END_TURN') {
      currentAgentName = result.agentName || currentAgentName;
      displayAgentResponse(currentAgentName || 'Agent', result.data);
    }
  }

  await telemetrySdkStop();
}

main();
