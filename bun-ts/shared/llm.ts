import { OpenAI } from 'openai';

export interface LLMConfig {
  apiKey: string;
  baseURL?: string;
}

export function createClient(config: LLMConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.baseURL?.includes('openrouter')
      ? { 'HTTP-Referer': 'https://localhost', 'X-Title': 'Scratchpad' }
      : undefined,
  });
}