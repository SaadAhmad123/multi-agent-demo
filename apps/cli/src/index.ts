import type { ArvoEvent } from 'arvo-core';
import { SimpleMachineMemory } from 'arvo-event-handler';
import { telemetrySdkStart, telemetrySdkStop } from './otel.js';
import { input } from '@inquirer/prompts';
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
  let humanReviewEvent: ArvoEvent | null = null;
  let currentAgentName: string | null = null;

  while (true) {
    const message = await input({
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

    // Show processing indicator
    process.stdout.write(chalk.gray('  thinking... '));

    const result = await requestProcessor({
      message: message,
      memory: memory,
      ...(humanReviewEvent
        ? { isHumanReview: true, humanReviewRequestEvent: humanReviewEvent }
        : { isHumanReview: false }),
    });

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
    } else if (result.type === '_END_TURN') {
      currentAgentName = result.agentName || currentAgentName;
      displayAgentResponse(currentAgentName || 'Agent', result.data);
      humanReviewEvent = null;
    }
  }

  await telemetrySdkStop();
}

main();
