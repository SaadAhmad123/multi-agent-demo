import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

marked.use(
  // biome-ignore lint/suspicious/noExplicitAny: This needs to be 'any'
  markedTerminal() as any,
);

/**
 * Displays a formatted welcome banner when the application starts
 */
export const displayWelcomeBanner = () => {
  //console.clear();
  console.log(chalk.cyan.bold('\n╔════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║     Agentic System Console v1.0       ║'));
  console.log(chalk.cyan.bold('╚════════════════════════════════════════╝\n'));
  console.log(chalk.white.bold('Getting Started:\n'));
  console.log(
    chalk.gray('  • Mention an agent with ') + chalk.cyan('@agentname') + chalk.gray(' to start interacting'),
  );
  console.log(chalk.gray('  • Type ') + chalk.cyan('/help') + chalk.gray(' to see all available commands'));
  console.log(chalk.gray('  • Type ') + chalk.cyan('/agents') + chalk.gray(' to list available agents'));
  console.log(
    chalk.gray('  • Type ') +
      chalk.cyan('/quit') +
      chalk.gray(' or ') +
      chalk.cyan('/exit') +
      chalk.gray(' to close\n'),
  );
};

/**
 * Displays the user's message in chat format
 * @param message - The user's input message
 */
export const displayUserMessage = (message: string) => {
  console.log(chalk.cyan('You:'));
  console.log(chalk.white(`  ${message}\n`));
};

/**
 * Formats and displays system messages (commands, errors, warnings)
 * @param message - The system message to display
 * @param type - The type of system message
 */
export const displaySystemMessage = (message: string, type: 'error' | 'info' | 'warning' = 'info') => {
  const config = {
    error: { prefix: '✗', color: chalk.red },
    info: { prefix: 'ℹ', color: chalk.blue },
    warning: { prefix: '⚠', color: chalk.yellow },
  }[type];

  console.log(config.color(`${config.prefix} System:`));
  console.log(chalk.gray(`  ${message}\n`));
};

/**
 * Formats and displays agent responses in chat format
 * @param agentName - The name of the responding agent
 * @param response - The agent's response message
 */
export const displayAgentResponse = (agentName: string, response: string) => {
  console.log(chalk.green(`@${agentName}:`));

  const renderedMarkdown = marked(response) as string;

  const lines = renderedMarkdown.split('\n');
  for (const line of lines) {
    console.log(`  ${line}`);
  }
  console.log('');
};

/**
 * Formats and displays a human review prompt in chat format
 * @param prompt - The review prompt message
 * @param agentName - The name of the agent requesting review (optional)
 */
export const displayHumanReviewPrompt = (prompt: string, agentName: string | null = null) => {
  const header = agentName ? `@${agentName} (requesting review):` : 'Agent (requesting review):';
  console.log(chalk.yellow(header));
  const lines = prompt.split('\n');
  for (const line of lines) {
    console.log(chalk.white(`  ${line}`));
  }
  console.log('');
};
