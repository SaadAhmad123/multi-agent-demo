import { ConfigViolation, type EventHandlerFactory, type IMachineMemory } from 'arvo-event-handler';
import {
  humanInteractionContract,
  humanInteractionServiceDomain,
} from '../agentFactory/contracts/humanInteraction.contract.js';
import { toolUseApprovalContract } from '../agentFactory/contracts/toolUseApproval.contract.js';
import { createAgenticResumable } from '../agentFactory/createAgenticResumable/index.js';
import { createMcpAgent } from '../agentFactory/createMcpAgent.js';
import type {
  AnyVersionedContract,
  IAgenticMCPClient,
  IToolUseApprovalMemory,
  LLMIntergration,
} from '../agentFactory/types.js';
import type { ArvoContract } from 'arvo-core';

export type AgentCommunityAgentParam<
  TAgentName extends string,
  TServiceKeys extends string,
  TLLMIntegrationKeys extends string,
  TMCPClientKeys extends string,
  TDomains extends string | typeof humanInteractionServiceDomain,
> = {
  name: TAgentName;
  llm: TLLMIntegrationKeys;
  alias?: string;
  description?: string;
  systemPrompt?: string;
  maxToolInteractionCycles?: number;
} & (
  | {
      tools?: Array<
        | TServiceKeys
        | {
            tool: TServiceKeys;
            domain: TDomains[];
          }
      >;
      // 'FULLY_SOCIAL' means that the Agent is able to talk to all agents in the community as peer
      peers?: (TAgentName | 'FULLY_SOCIAL')[];
      allowHumanInteraction?: boolean;
      restrictedTools?: TServiceKeys[];
      restrictedPeers?: TAgentName[];
      mcp?: never;
    }
  | {
      mcp: TMCPClientKeys;
      tools?: never;
      peers?: never;
    }
);

export class AgentCommunityBuilder<
  TCommunityName extends string = string,
  TServices extends Record<string, AnyVersionedContract> = Record<string, AnyVersionedContract>,
  TLLMIntegrations extends Record<string, LLMIntergration> = Record<string, LLMIntergration>,
  TMCPClients extends Record<string, IAgenticMCPClient> = Record<string, IAgenticMCPClient>,
  TDomains extends string = string,
> {
  public readonly humanInteractionContract = humanInteractionContract.version('1.0.0');
  public readonly toolUseApprovalContract = toolUseApprovalContract.version('1.0.0');
  public readonly domains: Array<TDomains | typeof humanInteractionServiceDomain> = ['human.interaction'];
  private readonly regexValidators = {
    alias: {
      regex: /^[a-zA-Z0-9]+$/,
      errorMessage:
        'Alias must contain only alphanumeric characters (a-z, A-Z, 0-9). Spaces, dots, and special characters are not allowed.',
    },
    name: {
      regex: /^[a-zA-Z0-9.]+$/,
      errorMessage:
        'Name must contain only alphanumeric characters (a-z, A-Z, 0-9) and dots (.). Spaces and other special characters are not allowed.',
    },
  };

  constructor(
    public readonly communityName: TCommunityName,
    public readonly services: TServices,
    public readonly llmIntegrations: TLLMIntegrations,
    public readonly mcpClients: TMCPClients,
    domains: TDomains[],
  ) {
    this.domains = [...this.domains, ...domains];
    if (!this.regexValidators.name.regex.test(this.communityName)) {
      throw new ConfigViolation(
        `Invalid community name: "${this.communityName}". ${this.regexValidators.name.errorMessage}`,
      );
    }
  }

  private validateCommunityNameAndAlias(param: { index: number; alias: string | null; name: string }[]) {
    const uniqueAliasesToIndexMap: Record<string, number> = {};
    const uniqueNamesToIndexMap: Record<string, number> = {};

    for (const item of param) {
      if (item.alias) {
        if (!this.regexValidators.alias.regex.test(item.alias)) {
          throw new ConfigViolation(
            `Invalid alias for agent at index ${item.index}: "${item.alias}". ${this.regexValidators.alias.errorMessage}`,
          );
        }
        if (item.alias in uniqueAliasesToIndexMap) {
          throw new ConfigViolation(
            `Duplicate alias detected: "${item.alias}" is already used by agent at index ${uniqueAliasesToIndexMap[item.alias]}. Agent at index ${item.index} must have a unique alias.`,
          );
        }
        uniqueAliasesToIndexMap[item.alias] = item.index;
      }

      if (!this.regexValidators.name.regex.test(item.name)) {
        throw new ConfigViolation(
          `Invalid name for agent at index ${item.index}: "${item.name}". ${this.regexValidators.name.errorMessage}`,
        );
      }
      if (item.name in uniqueNamesToIndexMap) {
        throw new ConfigViolation(
          `Duplicate name detected: "${item.name}" is already used by agent at index ${uniqueNamesToIndexMap[item.name]}. Agent at index ${item.index} must have a unique name.`,
        );
      }
      uniqueNamesToIndexMap[item.name] = item.index;
    }
  }

  validateUniqueServiceAndAgentContract(contract: ArvoContract, agentName: string, index: number) {
    const serviceContract = Object.entries(this.services).find(
      ([_, item]) => item.accepts.type === contract.type || item.uri === contract.uri,
    );
    if (serviceContract) {
      throw new ConfigViolation(
        `Contract conflict detected: Agent "${agentName}" shares event type "${contract.type}" or URI "${contract.uri}" with service "${serviceContract[0]}". Agents and services must have unique event types and URIs. Please update the agent's, at index "${index}", name in the configuration.`,
      );
    }
  }

  createCommunity<TAgentNames extends string>(
    param: Array<
      AgentCommunityAgentParam<
        TAgentNames,
        keyof TServices & string,
        keyof TLLMIntegrations & string,
        keyof TMCPClients & string,
        TDomains | typeof humanInteractionServiceDomain
      >
    >,
  ) {
    this.validateCommunityNameAndAlias(
      param.map((item, index) => ({
        index,
        alias: item.alias ?? null,
        name: item.name,
      })),
    );

    const resumableAgents: {
      agent: ReturnType<typeof createAgenticResumable>;
      config: (typeof param)[number];
    }[] = [];
    const mcpAgents: {
      agent: ReturnType<typeof createMcpAgent>;
      config: (typeof param)[number];
    }[] = [];
    const agentNameToContractMap: Record<string, ArvoContract> = {};

    for (const [index, item] of param.entries()) {
      if (!this.llmIntegrations[item.llm]) {
        throw new ConfigViolation(
          `Invalid LLM integration "${item.llm}" selected. The valid LLM integrations are: ${Object.keys(this.llmIntegrations).join(', ')}`,
        );
      }
      if (item.mcp && !this.mcpClients[item.mcp]) {
        throw new ConfigViolation(
          `Invlaid MCP Client "${item.mcp}" selected. The valid MCP Clients are: ${Object.keys(this.mcpClients).join(', ')}`,
        );
      }

      if (!item.tools?.length && !item.peers?.length) {
        const agent = createMcpAgent({
          alias: item.alias,
          name: item.name,
          description: item.description,
          maxToolInteractions: item.maxToolInteractionCycles,
          systemPrompt: () => item.systemPrompt ?? '',
          // biome-ignore lint/style/noNonNullAssertion: Already validated above
          agenticLLMCaller: this.llmIntegrations[item.llm]!,
          // biome-ignore lint/style/noNonNullAssertion: Already validated above
          mcpClient: item.mcp ? this.mcpClients[item.mcp]! : undefined,
        });
        this.validateUniqueServiceAndAgentContract(agent.contract, item.name, index);
        agentNameToContractMap[item.name] = agent.contract;
        mcpAgents.push({ agent, config: item });
      } else {
        const agent = createAgenticResumable({
          alias: item.alias,
          name: item.name,
          description: item.description,
          maxToolInteractions: item.maxToolInteractionCycles,
          systemPrompt: () => item.systemPrompt ?? '',
          // biome-ignore lint/style/noNonNullAssertion: Already validated above
          agenticLLMCaller: this.llmIntegrations[item.llm]!,
          toolUseApproval: item.restrictedTools?.length
            ? {
                require: true,
                domain: [humanInteractionServiceDomain],
                tools: item.restrictedTools,
              }
            : undefined,
          humanInteraction: item.allowHumanInteraction
            ? {
                require: true,
                domain: [humanInteractionServiceDomain],
              }
            : undefined,
        });
        this.validateUniqueServiceAndAgentContract(agent.contract, item.name, index);
        agentNameToContractMap[item.name] = agent.contract;
        resumableAgents.push({ agent, config: item });
      }
    }

    const agents: {
      contract: (typeof resumableAgents)[number]['agent']['contract'] | (typeof mcpAgents)[number]['agent']['contract'];
      alias: string | null;
      handlerFactory: EventHandlerFactory<{
        memory: IMachineMemory<Record<string, unknown>>;
        toolUseApprovalMemory?: IToolUseApprovalMemory;
      }>;
    }[] = [];

    for (const item of mcpAgents) {
      agents.push({
        contract: item.agent.contract,
        alias: item.agent.alias ?? null,
        handlerFactory: () => item.agent.handlerFactory({}),
      });
    }

    for (const item of resumableAgents) {
      const agentServices: Record<string, AnyVersionedContract> = {};
      const agentServiceDomains: Record<string, string[]> = {};

      for (const tool of item.config.tools ?? []) {
        const toolKey = typeof tool === 'string' ? tool : tool.tool;
        const toolDomains = typeof tool === 'string' ? [] : tool.domain;
        const toolContract = this.services[toolKey];
        if (!toolContract) {
          throw new ConfigViolation(
            `The service key "${toolKey}" required by agent "${item.config.name}" is not found. Please register the service with the appropriate key for the agent to be able to use it`,
          );
        }
        for (const domain of toolDomains) {
          if (!this.domains.includes(domain)) {
            throw new ConfigViolation(
              `The agent "${item.config.name}" configuration is setting the tool "${toolKey}" for domain "${domain}" which has not been registered in the setup.`,
            );
          }
        }
        agentServices[toolContract.dataschema] = toolContract;
        agentServiceDomains[toolContract.accepts.type] = toolDomains;
      }

      let agentPeers: string[] = item.config.peers?.includes('FULLY_SOCIAL')
        ? Object.keys(agentNameToContractMap)
        : (item.config.peers ?? []);
      agentPeers = agentPeers.filter((peer) => peer !== item.config.name);

      for (const peer of agentPeers) {
        const peerContract = agentNameToContractMap[peer]?.version('latest');
        if (!peerContract) {
          throw new ConfigViolation(
            `The agent peer "${peer}" does not exits. It required by the agent "${item.config.name}"`,
          );
        }
        agentServices[peerContract.dataschema] = peerContract;
      }

      agents.push({
        contract: item.agent.contract,
        alias: item.agent.alias ?? null,
        handlerFactory: ({ memory, toolUseApprovalMemory }) =>
          item.agent.handlerFactory({
            memory,
            toolUseApprovalMemory,
            extentions: {
              serviceDomains: agentServiceDomains,
              services: agentServices,
            },
          }),
      });
    }

    return {
      agents,
      domains: this.domains,
    };
  }
}
