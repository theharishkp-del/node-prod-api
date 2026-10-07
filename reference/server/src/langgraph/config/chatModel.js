import { ChatAnthropic } from '@langchain/anthropic';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

let chatModel;

export function getLanggraphChatModel() {
  if (!env.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required when LANGGRAPH_CHAT_ENABLED=true.');
  }

  if (!env.langgraphChatModel) {
    throw new Error('LANGGRAPH_CHAT_MODEL is required when LANGGRAPH_CHAT_ENABLED=true.');
  }

  if (env.langsmithTracing && !env.langsmithApiKey) {
    throw new Error('LANGSMITH_API_KEY is required when LANGSMITH_TRACING=true.');
  }

  if (!chatModel) {
    logger.info('LangGraph chat model initialization started', {
      model: env.langgraphChatModel,
      maxTokens: env.langgraphMaxTokens,
      langsmithTracing: env.langsmithTracing,
      langsmithProject: env.langsmithProject,
    });

    chatModel = new ChatAnthropic({
      anthropicApiKey: env.anthropicApiKey,
      model: env.langgraphChatModel,
      temperature: 0,
      maxTokens: env.langgraphMaxTokens,
      maxRetries: 2,
    });

    logger.info('LangGraph chat model initialized', {
      model: env.langgraphChatModel,
    });
  }

  return chatModel;
}
