
import { config } from 'dotenv';
import OpenAI from 'openai';

config({ path: '../.env' });

const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  throw new Error('OPENROUTER_API_KEY environment variable is required');
}

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'localhost', // Optional. Site URL for rankings on openrouter.ai.
    'X-Title': 'localhost', // Optional. Site title for rankings on openrouter.ai.
  },
});
async function main() {
  const completion = await openai.chat.completions.create({
    model: 'qwen/qwen3-8b',
    messages: [
      {
        role: 'user',
        content: 'What is the meaning of life?',
      },
    ],
  });
  const response = completion!.choices[0]!.message!.content
  console.log(response);
}
await main();
