import { humanInteractionServiceDomain } from '../agentFactory/contracts/humanInteraction.contract.js';
import { validateServiceContract } from '../agentFactory/createAgenticResumable/utils.js';
import type { AnyVersionedContract, IAgenticMCPClient, LLMIntergration } from '../agentFactory/types.js';
import { AgentCommunityBuilder } from './Builder.js';

export const setupAgentCommunity = <
  TCommunityName extends string,
  TServices extends Record<string, AnyVersionedContract>,
  TLLMIntegrations extends Record<string, LLMIntergration>,
  TMCPClients extends Record<string, IAgenticMCPClient>,
  TDomains extends string = string,
  THumanInteractionDomain extends string = typeof humanInteractionServiceDomain,
>(param: {
  name: TCommunityName;
  llmIntegrations: TLLMIntegrations;
  services?: TServices;
  mcpClients?: TMCPClients;
  domains?: TDomains[];
  humanInteractionDomain?: THumanInteractionDomain;
}) => {
  validateServiceContract(param.services ?? {}, 'BUILD');
  return new AgentCommunityBuilder(
    param.name,
    param.services ?? ({} as never),
    param.llmIntegrations,
    param.mcpClients ?? ({} as never),
    param.domains ?? ([] as never[]),
    param.humanInteractionDomain ?? humanInteractionServiceDomain,
  );
};
