import { ConfigViolation, type EventHandlerFactory, type IMachineMemory } from 'arvo-event-handler';
import { humanInteractionContract } from '../agentFactory/contracts/humanInteraction.contract.js';
import { toolUseApprovalContract } from '../agentFactory/contracts/toolUseApproval.contract.js';
import { createAgenticResumable } from '../agentFactory/createAgenticResumable/index.js';
import { createMcpAgent } from '../agentFactory/createMcpAgent.js';
import type {
  AnyVersionedContract,
  IAgenticMCPClient,
  IToolUseApprovalMemory,
  LLMIntergration,
} from '../agentFactory/types.js';
import { cleanString, type ArvoContract } from 'arvo-core';

const FULLY_SOCIAL_PEER_CONFIG = 'FULLY_SOCIAL' as const;

export type AgentCommunityAgentParam<
  TAgentName extends string,
  TServiceKeys extends string,
  TLLMIntegrationKeys extends string,
  TMCPClientKeys extends string,
  TDomains extends string,
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
            domains: TDomains[];
          }
      >;
      // 'FULLY_SOCIAL' means that the Agent is able to talk to all agents in the community as peer
      peers?: (TAgentName | typeof FULLY_SOCIAL_PEER_CONFIG)[];
      allowHumanInteraction?: boolean;
      restrictedTools?: TServiceKeys[];
      restrictedPeers?: TAgentName[];
      mcp?: never;
      operator?: boolean;
    }
  | {
      mcp: TMCPClientKeys;
      tools?: never;
      peers?: never;
      operator?: never;
    }
);

export class AgentCommunityBuilder<
  TCommunityName extends string = string,
  TServices extends Record<string, AnyVersionedContract> = Record<string, AnyVersionedContract>,
  TLLMIntegrations extends Record<string, LLMIntergration> = Record<string, LLMIntergration>,
  TMCPClients extends Record<string, IAgenticMCPClient> = Record<string, IAgenticMCPClient>,
  TDomains extends string = string,
  THumanInteractionDomain extends string = string,
> {
  public readonly humanInteractionContract = humanInteractionContract.version('1.0.0');
  public readonly toolUseApprovalContract = toolUseApprovalContract.version('1.0.0');
  public readonly domains: Array<TDomains | THumanInteractionDomain> = [];
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
    public readonly humanInteractionDomain: THumanInteractionDomain,
  ) {
    this.domains = [...domains, humanInteractionDomain];
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

  private validateUniqueServiceAndAgentContract(contract: ArvoContract, agentName: string, index: number) {
    const serviceContract = Object.entries(this.services).find(
      ([_, item]) => item.accepts.type === contract.type || item.uri === contract.uri,
    );
    if (serviceContract) {
      throw new ConfigViolation(
        `Contract conflict detected: Agent "${agentName}" shares event type "${contract.type}" or URI "${contract.uri}" with service "${serviceContract[0]}". Agents and services must have unique event types and URIs. Please update the agent's, at index "${index}", name in the configuration.`,
      );
    }
  }

  private validateCommunityOperator(
    param: {
      name: string;
      alias?: string;
      operator?: boolean;
      peers?: Array<string | typeof FULLY_SOCIAL_PEER_CONFIG>;
    }[],
  ) {
    let operatorFound: (typeof param)[number] | null = null;
    for (const item of param) {
      if (item.alias && item.operator && item.peers?.includes(FULLY_SOCIAL_PEER_CONFIG)) {
        if (operatorFound) {
          throw new ConfigViolation(
            `Only one 'operator' allowed in a community. Detected an second operator (name=${item.name}, alias=${item.alias})`,
          );
        }
        operatorFound = item;
      }
    }
    if (operatorFound) return;
    throw new ConfigViolation(
      `No default operator found in the community. An operator is required to act as the default agent in the community. Make sure to make one agent in the community have an alias, operator = true and peers to be ${FULLY_SOCIAL_PEER_CONFIG}`,
    );
  }

  private createUserFacingCommunityContextSystemPrompt(agentAlias: string, operatorAlias: string, peers?: boolean) {
    return cleanString(`
      # Critical: Agent Community Operating Guidelines You Must Follow

      You are "${agentAlias}" operating within the ${this.communityName} agent community. 
      Your effectiveness depends on recognizing your operational boundaries and routing 
      requests appropriately.

      ## Your Operational Boundaries
      
      **Within Your Scope:**
      - Use your available tools to handle requests that match your specialization
      - Call agent tools you have direct access to when their capabilities are needed
      - Answer questions within your domain knowledge without requiring tools
      
      **Outside Your Scope:**
      - Requests requiring agents you cannot access directly
      - Workflows spanning multiple agents or domains
      - Tasks needing system-level coordination or resource management

      ## Community Architecture

      This community comprises specialized agents with varying capabilities 
      and access patterns. You can only interact with agents explicitly available 
      in your tool set through direct tool calls. Other agents may have aliases 
      for human access but remain outside your interaction scope. Never attempt 
      to simulate or approximate capabilities of inaccessible agents.

      ${
        agentAlias !== operatorAlias
          ? cleanString(`
              ## Escalation Principle
              
              When a request exceeds your operational boundaries, immediately ask the user to escalate to "${operatorAlias}" 
              without attempting to fulfill any part of the request.
              
              Do NOT:
              - Provide partial answers or solutions
              - Complete only the parts you can handle
              - Solve portions of the request before escalating
              
              Instead, recognize the complete request requires orchestration and escalate entirely.
              
              **Escalation Template:**
              "You request requires [what's missing: specific agents/capabilities/coordination]. Please ask @${operatorAlias} 
              to handle this as they have broader system visibility over system capabilities"
              
              **Never:**
              - Instruct users to chain requests across multiple agents ("ask @agent1, then ask @agent2")
              - Attempt to coordinate workflows beyond your tool access
              - Promise capabilities you don't have
              - Complete parts of requests that require orchestration
          `)
          : cleanString(`
            ## You Responsibilities As Community Operator

            As community operator, you possess full agent roster visibility via your tools set and 
            coordination ability. 
          `)
      }

      ${
        peers
          ? cleanString(`
            Humans can also directly talks to agents available in your toolset ONLY IF those agents
            have alias otherwise human cannot directly interact with agent non-alias agents and you
            need to coordinate with them to fulfil the user request
          `)
          : ''
      }
    `);
  }

  createCommunity<TAgentNames extends string>(
    param: [
      AgentCommunityAgentParam<
        TAgentNames,
        keyof TServices & string,
        keyof TLLMIntegrations & string,
        keyof TMCPClients & string,
        TDomains | THumanInteractionDomain
      >,
      ...AgentCommunityAgentParam<
        TAgentNames,
        keyof TServices & string,
        keyof TLLMIntegrations & string,
        keyof TMCPClients & string,
        TDomains | THumanInteractionDomain
      >[],
    ],
  ) {
    this.validateCommunityNameAndAlias(
      param.map((item, index) => ({
        index,
        alias: item.alias ?? null,
        name: item.name,
      })),
    );
    this.validateCommunityOperator(
      param.map((item) => ({ name: item.name, alias: item.alias, operator: item.operator, peers: item.peers })),
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

    let defaultOperatorAgentAlias: string | null = null;

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
          toolUseApproval: [...(item.restrictedTools ?? []), ...(item.restrictedPeers ?? [])].length
            ? {
                require: true,
                domain: [this.humanInteractionDomain],
                tools: [],
              }
            : undefined,
          humanInteraction: item.allowHumanInteraction
            ? {
                require: true,
                domain: [this.humanInteractionDomain],
              }
            : undefined,
        });
        this.validateUniqueServiceAndAgentContract(agent.contract, item.name, index);
        agentNameToContractMap[item.name] = agent.contract;
        resumableAgents.push({ agent, config: item });
      }
      if (item.operator) {
        defaultOperatorAgentAlias = item.alias ?? null;
      }
    }

    if (!defaultOperatorAgentAlias) {
      throw new ConfigViolation(
        'No default operator detected in the community. Invalid configuration. Define an operator',
      );
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
        handlerFactory: () =>
          item.agent.handlerFactory({
            extentions: {
              systemPrompt: item.agent.alias
                ? this.createUserFacingCommunityContextSystemPrompt(item.agent.alias, defaultOperatorAgentAlias, false)
                : undefined,
            },
          }),
      });
    }

    let defaultOperatorAgent: (typeof agents)[number] | null = null;

    for (const item of resumableAgents) {
      const agentServices: Record<string, AnyVersionedContract> = {};
      const agentServiceDomains: Record<string, string[]> = {};

      for (const tool of item.config.tools ?? []) {
        const toolKey = typeof tool === 'string' ? tool : tool.tool;
        const toolDomains = typeof tool === 'string' ? [] : tool.domains;
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

      const restrictedPeerTypes: string[] = [];
      // @ts-ignore
      for (const rp of (item.config.restrictedPeers ?? []) as string[]) {
        if (agentNameToContractMap[rp]) {
          restrictedPeerTypes.push(agentNameToContractMap[rp].type);
        }
      }

      const _agent: (typeof agents)[number] = {
        contract: item.agent.contract,
        alias: item.agent.alias ?? null,
        handlerFactory: ({ memory, toolUseApprovalMemory }) =>
          item.agent.handlerFactory({
            memory,
            toolUseApprovalMemory,
            extentions: {
              serviceDomains: agentServiceDomains,
              // @ts-ignore
              servicesRequireApproval: [...restrictedPeerTypes, ...(item.config.restrictedTools ?? [])],
              services: agentServices,
              systemPrompt: item.agent.alias
                ? this.createUserFacingCommunityContextSystemPrompt(
                    item.agent.alias,
                    defaultOperatorAgentAlias,
                    Boolean(agentPeers.length),
                  )
                : undefined,
            },
          }),
      };

      if (item.config.operator) {
        defaultOperatorAgent = _agent;
      }

      agents.push(_agent);
    }

    if (!defaultOperatorAgent) {
      throw new ConfigViolation(
        'No default operator detected in the community. Invalid configuration. Define an operator',
      );
    }

    return {
      agents,
      domains: this.domains,
      humanInteraction: {
        domain: this.humanInteractionDomain,
        contract: this.humanInteractionContract,
      },
      toolUseApproval: {
        domain: this.humanInteractionDomain,
        contract: this.toolUseApprovalContract,
      },
      defaultOperatorAgent: defaultOperatorAgent as unknown as Omit<typeof defaultOperatorAgent, 'alias'> & {
        alias: string;
      },
    };
  }
}
