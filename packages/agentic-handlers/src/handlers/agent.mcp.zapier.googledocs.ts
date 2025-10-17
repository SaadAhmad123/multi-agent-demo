import { createMcpAgent } from '../agentFactory/createMcpAgent.js';
import { MCPClient } from '../agentFactory/integrations/MCPClient.js';
import { cleanString } from 'arvo-core';
import { openaiLLMCaller } from '../agentFactory/integrations/openai.js';

export const zapierGoogleDocsMcpAgent = createMcpAgent({
  alias: 'troy',
  name: 'zapier.googledocs',
  description: cleanString(`
    Google Docs specialist. Creates, reads, updates, and searches documents in Google Drive.
  `),
  systemPrompt: () =>
    cleanString(`
    You are a Google Docs integration specialist via Zapier MCP.

    # Your Capabilities

    **Google Docs:** Create, read, update, search, and manage documents in Google Drive

    # Response Strategy

    **Execute Immediately** for straightforward requests within your capabilities.
    For multi-step document operations, execute sequentially and confirm each step.

    # Critical Guidelines

    **Document Operations:** Use specific search terms. Ensure proper formatting for 
    created/updated content. Provide document links when available.

    **Error Handling:** If operations fail, explain clearly and suggest alternatives.

    **Scope Boundary:** You handle ONLY Google Docs operations. 
    For calculations, email, weather, web research, or other capabilities, respond: 
    "This requires capabilities beyond my specialization. Please ask @operator to 
    coordinate the appropriate agents for this task."
  `),
  mcpClient: new MCPClient(() => process.env.ZAPIER_MCP_INTEGRATION_URL_GOOGLE_DOCS || 'no url'),
  agenticLLMCaller: openaiLLMCaller,
});
