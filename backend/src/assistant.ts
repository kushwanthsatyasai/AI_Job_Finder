import { z } from 'zod';
import { ChatGroq } from '@langchain/groq';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { StateGraph, StateSchema, MessagesValue, ReducedValue, START, END } from '@langchain/langgraph';
import { log } from './logger.js';

export type FiltersPatch = {
  roleTitle?: string;
  skills?: string[];
  datePosted?: '24h' | 'week' | 'month' | 'any';
  jobType?: 'Any' | 'Full-time' | 'Part-time' | 'Contract' | 'Internship' | 'Unknown';
  workMode?: 'Any' | 'Remote' | 'Hybrid' | 'On-site' | 'Unknown';
  location?: string;
  matchScoreBand?: 'High' | 'Medium' | 'All';
};

export type AssistantAction =
  | { type: 'setFilters'; patch: FiltersPatch }
  | { type: 'clearFilters' }
  | { type: 'navigate'; to: '/jobs' | '/applications' };

const setFiltersTool = tool(async (_input: any) => {
  return { ok: true };
}, {
  name: 'setFilters',
  description: 'Update job feed filters (patch semantics).',
  schema: z.object({
    patch: z.object({
      roleTitle: z.string().optional(),
      skills: z.array(z.string()).optional(),
      datePosted: z.enum(['24h', 'week', 'month', 'any']).optional(),
      jobType: z.enum(['Any', 'Full-time', 'Part-time', 'Contract', 'Internship', 'Unknown']).optional(),
      workMode: z.enum(['Any', 'Remote', 'Hybrid', 'On-site', 'Unknown']).optional(),
      location: z.string().optional(),
      matchScoreBand: z.enum(['High', 'Medium', 'All']).optional(),
    }),
  }),
});

const clearFiltersTool = tool(async (_input: any) => {
  return { ok: true };
}, {
  name: 'clearFilters',
  description: 'Clear all filters (reset to defaults).',
  schema: z.object({}),
});

const navigateTool = tool(async (_input: any) => {
  return { ok: true };
}, {
  name: 'navigate',
  description: 'Navigate user to a route in the app.',
  schema: z.object({ to: z.enum(['/jobs', '/applications']) }),
});

const toolsByName = {
  setFilters: setFiltersTool,
  clearFilters: clearFiltersTool,
  navigate: navigateTool,
};
const tools = Object.values(toolsByName);

const AssistantState = new StateSchema({
  messages: MessagesValue,
  actions: new ReducedValue(z.array(z.any()).default([]), { reducer: (x, y) => x.concat(y) }),
  intent: new ReducedValue(z.string().default(''), { reducer: (_x, y) => String(y || '') }),
});

const systemPrompt = `You are the AI assistant inside a job tracking web app.\n\nYou MUST use tools to update UI filters. Do not merely describe filter changes.\n\nCapabilities:\n- setFilters({patch}) to update the Job Feed filters (role/title text, skills array, datePosted, jobType, workMode, location, matchScoreBand).\n- clearFilters() to reset filters.\n- navigate({to}) to switch pages.\n\nUser requests examples:\n- \"Show only remote jobs\" -> setFilters({workMode:\"Remote\"})\n- \"Filter by last 24 hours\" -> setFilters({datePosted:\"24h\"})\n- \"Only full-time roles in Bangalore\" -> setFilters({jobType:\"Full-time\", location:\"Bangalore\"})\n- \"High match scores only\" -> setFilters({matchScoreBand:\"High\"})\n- \"Clear all filters\" -> clearFilters()\n\nIf the user asks product questions, respond normally without tools.\nRespect existing filters: patch changes only what user asked; do not wipe other filters unless asked.\n`;

function fallbackActions(message: string): { assistantText: string; actions: AssistantAction[] } {
  const text = message.toLowerCase();
  const actions: AssistantAction[] = [];

  if (/(clear|reset).*(filters?)/i.test(message) || /^clear$/i.test(message.trim())) {
    actions.push({ type: 'clearFilters' });
    return { assistantText: 'Cleared all filters.', actions };
  }

  if (/(go|open|show).*(applications?)/i.test(message)) {
    actions.push({ type: 'navigate', to: '/applications' });
    return { assistantText: 'Opening your applications dashboard.', actions };
  }

  const patch: FiltersPatch = {};

  if (/\bremote\b/.test(text) || /\bwfh\b/.test(text) || /work from home/.test(text)) patch.workMode = 'Remote';
  if (/\bhybrid\b/.test(text)) patch.workMode = 'Hybrid';
  if (/\bon[- ]site\b/.test(text) || /\bon site\b/.test(text)) patch.workMode = 'On-site';

  if (/\bfull[- ]time\b/.test(text) || /\bfull time\b/.test(text)) patch.jobType = 'Full-time';
  if (/\bpart[- ]time\b/.test(text) || /\bpart time\b/.test(text)) patch.jobType = 'Part-time';
  if (/\bcontract\b/.test(text)) patch.jobType = 'Contract';
  if (/\bintern(ship)?\b/.test(text)) patch.jobType = 'Internship';

  if (/last 24 hours|24h|today/.test(text)) patch.datePosted = '24h';
  if (/last week|this week|past week/.test(text)) patch.datePosted = 'week';
  if (/last month|this month|past month/.test(text)) patch.datePosted = 'month';
  if (/any time|anytime|all time/.test(text)) patch.datePosted = 'any';

  if (/high match|best match|above 70|> ?70/.test(text)) patch.matchScoreBand = 'High';
  if (/medium match|40|70/.test(text) && /match/.test(text)) patch.matchScoreBand = 'Medium';

  const skills: string[] = [];
  if (/\breact\b/.test(text)) skills.push('React');
  if (/\bnode(\.js)?\b/.test(text)) skills.push('Node.js');
  if (/\bpython\b/.test(text)) skills.push('Python');
  if (/\btypescript\b/.test(text)) skills.push('TypeScript');
  if (/\bfastify\b/.test(text)) skills.push('Fastify');
  if (/\bpytorch\b/.test(text)) skills.push('PyTorch');
  if (/\btensorflow\b/.test(text)) skills.push('TensorFlow');
  if (skills.length) patch.skills = skills;

  const inMatch = message.match(/\bin\s+([A-Za-z][A-Za-z .-]{1,40})/);
  if (inMatch?.[1]) patch.location = inMatch[1].trim();

  const roleMatch = message.match(/(?:show me|find|search for)\s+(.+?)\s+(?:jobs?|roles?)/i);
  if (roleMatch?.[1]) patch.roleTitle = roleMatch[1].trim();

  if (Object.keys(patch).length) {
    actions.push({ type: 'setFilters', patch });
    return { assistantText: 'Updated your filters.', actions };
  }

  return {
    assistantText:
      'Tell me what to filter (e.g., “only remote React jobs posted this week”, “full-time roles in Bangalore”, “clear all filters”).',
    actions: [],
  };
}

function makeModel(provider: 'groq' | 'sarvam') {
  const llm = provider === 'groq'
    ? new ChatGroq({ apiKey: process.env.GROQ_API_KEY!, model: process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct', temperature: 0 })
    : new ChatOpenAI({ apiKey: process.env.SARVAM_API_KEY!, model: process.env.SARVAM_MODEL || 'sarvam-30b', temperature: 0, configuration: { baseURL: 'https://api.sarvam.ai/v1' } });

  return llm.bindTools(tools);
}

function makeChatOnlyModel(provider: 'groq' | 'sarvam') {
  return provider === 'groq'
    ? new ChatGroq({ apiKey: process.env.GROQ_API_KEY!, model: process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct', temperature: 0.2 })
    : new ChatOpenAI({ apiKey: process.env.SARVAM_API_KEY!, model: process.env.SARVAM_MODEL || 'sarvam-30b', temperature: 0.2, configuration: { baseURL: 'https://api.sarvam.ai/v1' } });
}

const router = async (state: any) => {
  const last = state.messages.at(-1);
  const text = last && 'content' in last ? String((last as any).content ?? '') : '';
  const t = text.toLowerCase();

  const looksLikeFilter =
    /(filter|show|only|remote|wfh|hybrid|on[- ]?site|full[- ]?time|part[- ]?time|contract|intern|last 24|week|month|clear)/i.test(text)
    || /\breact\b|\bnode\b|\bpython\b|\bjava\b|\bflutter\b|\baws\b/i.test(text);
  const looksLikeNavigation = /(applications|dashboard|go to|open)/i.test(text);
  const looksLikeHelp = /(how|what|why|explain|help|can you)/i.test(text);

  const intent =
    looksLikeNavigation ? 'navigate'
    : looksLikeFilter ? 'filters'
    : looksLikeHelp ? 'help'
    : 'chat';

  return { intent };
};

const actionExtract = async (state: any) => {
  const last = state.messages.at(-1);
  const text = last && 'content' in last ? String((last as any).content ?? '') : '';
  const fb = fallbackActions(text);
  return { actions: fb.actions, messages: [] };
};

const answerOnly = async (state: any) => {
  const providers: ('groq' | 'sarvam')[] = [];
  if (process.env.GROQ_API_KEY) providers.push('groq');
  if (process.env.SARVAM_API_KEY) providers.push('sarvam');
  const last = state.messages.at(-1);
  const text = last && 'content' in last ? String((last as any).content ?? '') : '';

  if (!providers.length) {
    return { messages: [new AIMessage('I can help with filters, matching, applications, or using the app. What would you like to do?')] };
  }

  for (const provider of providers) {
    try {
      const started = Date.now();
      const model = makeChatOnlyModel(provider);
      const response = await model.invoke([
        new SystemMessage(systemPrompt + '\nWhen NOT changing filters, answer concisely and ask one clarifying question if needed.'),
        ...state.messages,
      ]);
      log.debug({ mode: provider, ms: Date.now() - started }, 'assistant.answer');
      return { messages: [response] };
    } catch (err: any) {
      log.warn({ mode: provider, error: err?.message?.slice(0, 200) }, 'assistant.answer: provider failed, trying next');
    }
  }

  return { messages: [new AIMessage('I had trouble generating an answer. Try rephrasing your question.')] };
};

function routeNext(state: any) {
  const intent = String(state.intent || '');
  if (intent === 'filters' || intent === 'navigate') return 'llmCall';
  // For general help/chat, run answer + action suggestion in parallel.
  return 'fanout';
}

const join = (state: any) => {
  // Keep the latest AIMessage (answerOnly) as visible response.
  const lastAi = [...(state.messages || [])].reverse().find((m: any) => m && AIMessage.isInstance(m));
  return lastAi ? { messages: [lastAi] } : { messages: [new AIMessage('Done.')] };
};

const llmCall = async (state: any) => {
  const last = state.messages.at(-1);
  const text = last && 'content' in last ? String((last as any).content ?? '') : '';

  const providers: ('groq' | 'sarvam')[] = [];
  if (process.env.GROQ_API_KEY) providers.push('groq');
  if (process.env.SARVAM_API_KEY) providers.push('sarvam');

  if (!providers.length) {
    const fb = fallbackActions(text);
    log.debug({ mode: 'fallback', actions: fb.actions }, 'assistant.invoke');
    return { actions: fb.actions, messages: [new AIMessage(fb.assistantText)] };
  }

  for (const provider of providers) {
    try {
      const started = Date.now();
      const model = makeModel(provider);
      const response = await model.invoke([new SystemMessage(systemPrompt), ...state.messages]);
      log.debug({ mode: provider, ms: Date.now() - started }, 'assistant.llm');
      return { messages: [response] };
    } catch (err: any) {
      log.warn({ mode: provider, error: err?.message?.slice(0, 200) }, 'assistant.llm: provider failed, trying next');
    }
  }

  const fb = fallbackActions(text);
  log.warn({ actions: fb.actions }, 'assistant.llm: all providers failed, rule-based fallback');
  return { actions: fb.actions, messages: [new AIMessage(fb.assistantText)] };
};

const toolNode = async (state: any) => {
  const last = state.messages.at(-1);
  if (!last || !AIMessage.isInstance(last)) return { messages: [] };

  const result: ToolMessage[] = [];
  const actions: AssistantAction[] = [];
  for (const toolCall of last.tool_calls ?? []) {
    const toolImpl = (toolsByName as any)[toolCall.name];
    if (!toolImpl) continue;
    if (toolCall.name === 'setFilters') {
      actions.push({ type: 'setFilters', patch: (toolCall.args as any).patch });
    } else if (toolCall.name === 'clearFilters') {
      actions.push({ type: 'clearFilters' });
    } else if (toolCall.name === 'navigate') {
      actions.push({ type: 'navigate', to: (toolCall.args as any).to });
    }
    const observation = await toolImpl.invoke(toolCall);
    result.push(observation);
  }

  if (actions.length) log.info({ actions }, 'assistant.actions');
  return { messages: result, actions };
};

const summarize = (state: any) => {
  const actions: AssistantAction[] = state.actions || [];
  const parts: string[] = [];
  for (const action of actions) {
    if (action.type === 'setFilters') {
      const entries = Object.entries(action.patch)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join(', ');
      parts.push(`Updated filters — ${entries}`);
    } else if (action.type === 'clearFilters') {
      parts.push('Cleared all filters');
    } else if (action.type === 'navigate') {
      parts.push(`Navigating to ${action.to === '/applications' ? 'Applications' : 'Job Feed'}`);
    }
  }
  const text = parts.length
    ? `${parts.join('. ')}. Let me know if you'd like to adjust anything else!`
    : 'Done! Let me know if you need anything else.';
  return { messages: [new AIMessage(text)] };
};

const shouldContinue = (state: any) => {
  const last = state.messages.at(-1);
  if (!last || !AIMessage.isInstance(last)) return END;
  if (last.tool_calls?.length) return 'toolNode';
  return END;
};

const graph = new StateGraph(AssistantState)
  .addNode('router', router)
  .addNode('fanout', async (_state: any) => ({}))
  .addNode('llmCall', llmCall)
  .addNode('toolNode', toolNode)
  .addNode('summarize', summarize)
  .addNode('actionExtract', actionExtract)
  .addNode('answerOnly', answerOnly)
  .addNode('join', join)
  .addEdge(START, 'router')
  .addConditionalEdges('router', routeNext, ['llmCall', 'fanout'])
  // fanout pseudo-node: router can branch to both nodes in parallel
  .addEdge('fanout', 'answerOnly')
  .addEdge('fanout', 'actionExtract')
  .addEdge('answerOnly', 'join')
  .addEdge('actionExtract', 'join')
  .addConditionalEdges('llmCall', shouldContinue, ['toolNode', END])
  .addEdge('toolNode', 'summarize')
  .addEdge('summarize', END)
  .addEdge('join', END)
  .compile();

export async function runAssistant(args: { message: string; history?: { role: 'user' | 'assistant'; content: string }[] }) {
  const messages: BaseMessage[] = [];
  for (const h of args.history || []) {
    if (h.role === 'user') messages.push(new HumanMessage(h.content));
    else messages.push(new AIMessage(h.content));
  }
  messages.push(new HumanMessage(args.message));

  const res = await graph.invoke({ messages, actions: [] });
  const last = res.messages.at(-1);
  const assistantText = last && 'content' in last ? String((last as any).content ?? '') : '';
  return { assistantText, actions: (res.actions as AssistantAction[]) ?? [] };
}

