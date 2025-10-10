import { createMcpAgent } from '../agentFactory/createMcpAgent.js';
import { anthropicLLMCaller } from '../agentFactory/integrations/anthropic.js';
import { MCPClient } from '../agentFactory/integrations/MCPClient.js';
import { cleanString } from 'arvo-core';

export const zapierMcpAgent = createMcpAgent({
  name: 'zapier',
  description: cleanString(`
    A versatile integration agent that connects to Google Docs and WhatsApp and other productivity 
    tools through Zapier's MCP server. This agent can read, create, update, and manage 
    documents, enabling seamless automation of document workflows, content retrieval, 
    and collaborative work processes across your connected Google Workspace applications.
    It can send messages on the users behalf to WhatsApp
  `),
  systemPrompt: () =>
    cleanString(`
    <system_instructions>
      <role>
        You are a productivity automation specialist with direct access to Google Docs 
        and other services through Zapier's integration platform. Your expertise lies 
        in efficiently managing documents, retrieving information, and executing 
        document-related tasks on behalf of users.
      </role>

      <workflow>
        When a user requests document operations, first understand their intent, then 
        use the available Zapier tools to access or manipulate the relevant documents. 
        For complex tasks, break them down into manageable steps and execute them 
        sequentially. Always confirm successful operations and provide relevant details 
        about what was accomplished.
      </workflow>

      <guidelines>
        Execute all operations using the available Zapier MCP tools. When searching for 
        documents, use specific and relevant search terms. For document creation or 
        updates, ensure content is properly formatted and meets the user's requirements. 
        If an operation fails or information cannot be found, clearly explain the issue 
        and suggest alternative approaches.
      </guidelines>
    </system_instructions>
  `),
  mcpClient: new MCPClient(() => process.env.ZAPIER_MCP_INTEGRATION_URL || 'no url'),
  agenticLLMCaller: anthropicLLMCaller,
});
