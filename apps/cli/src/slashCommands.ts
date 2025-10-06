import { agentMap } from './agentsMap.js';

/**
 * Output type for slash command execution results
 */
export type SlashCommandOutput = {
  type: '_INFO' | '_EXIT';
  data: string;
};

/**
 * Handler function type for slash commands
 */
export type SlashCommandHandler = (command: string, content: string, raw: string) => SlashCommandOutput | null;

/**
 * Registry mapping command names to their handler functions
 */
export type SlashCommandRegistry = Record<string, SlashCommandHandler>;

/**
 * Built-in slash command handlers for the agentic system.
 * Add new commands by extending this registry.
 */
const slashCommandRegistry: SlashCommandRegistry = {
  agents: () => ({
    type: '_INFO',
    data: `The available agents are:\n${Object.entries(agentMap)
      .map(([key, value], index) => `${index + 1}. @${key}: ${value.contract.description}`)
      .join('\n\n')}`,
  }),

  quit: () => ({
    type: '_EXIT',
    data: 'Quitting the agentic system. Thanks for using it!',
  }),

  exit: () => ({
    type: '_EXIT',
    data: 'Quitting the agentic system. Thanks for using it!',
  }),

  help: () => ({
    type: '_INFO',
    data: `Available commands:
  /agents - List all available agents
  /help - Show this help message
  /quit or /exit - Exit the application
  
You can also use commands with arguments like:
  /command <arguments>`,
  }),
};

/**
 * Parses a slash command message into its components
 * @param message - The raw message starting with /
 * @returns Parsed command object with command name, content, and raw message, or null if not a slash command
 *
 * @example
 * ```typescript
 * parseSlashCommand("/setup What are you")
 * // Returns: { command: "setup", content: "What are you", raw: "/setup What are you" }
 *
 * parseSlashCommand("/agents")
 * // Returns: { command: "agents", content: "", raw: "/agents" }
 * ```
 */
const parseSlashCommand = (message: string): { command: string; content: string; raw: string } | null => {
  if (!message.startsWith('/')) {
    return null;
  }

  const withoutSlash = message.slice(1);
  const spaceIndex = withoutSlash.indexOf(' ');

  if (spaceIndex === -1) {
    return {
      command: withoutSlash.toLowerCase().trim(),
      content: '',
      raw: message,
    };
  }

  return {
    command: withoutSlash.slice(0, spaceIndex).toLowerCase().trim(),
    content: withoutSlash.slice(spaceIndex + 1).trim(),
    raw: message,
  };
};

/**
 * Processes slash commands for system operations.
 * Supports both simple commands (/agents) and commands with arguments (/setup config).
 *
 * @param message - The user input string to check for slash commands
 * @returns A response object with type and data if a command is recognized, null if not a slash command
 *
 * @example
 * ```typescript
 * processSlashCommands("/agents")
 * // Returns: { type: "_INFO", data: "The available agents are:..." }
 *
 * processSlashCommands("/unknown")
 * // Returns: { type: "_INFO", data: "Unknown command: /unknown..." }
 *
 * processSlashCommands("regular message")
 * // Returns: null
 * ```
 */
export const processSlashCommands = (message: string): SlashCommandOutput | null => {
  const parsed = parseSlashCommand(message);
  if (!parsed) {
    return null;
  }
  const { command, content, raw } = parsed;
  if (command in slashCommandRegistry) {
    // biome-ignore lint/style/noNonNullAssertion: Command exists in registry
    return slashCommandRegistry[command]!(command, content, raw);
  }
  return {
    type: '_INFO',
    data: `Unknown command: /${command}\nType /help to see available commands.`,
  };
};
