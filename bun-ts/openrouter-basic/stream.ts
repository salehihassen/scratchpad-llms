import { OpenRouter } from '@openrouter/sdk';

import { config } from 'dotenv';

config({ path: '../.env' });
const apiKey = process.env.OPENROUTER_API_KEY;


const openRouter = new OpenRouter({
  apiKey: apiKey,
});
const question = 'How many Cs are in this question?';
const stream = await openRouter.chat.send({
  chatGenerationParams: {
    model: 'qwen/qwen3-vl-8b-instruct',
    messages: [{ role: 'user', content: question }],
    stream: true,
  },
});
let isAborted = false;
process.on('SIGINT', () => {
  isAborted = true;
  process.stdout.write('\n');  // Newline before exit
  process.exit(0);
});

for await (const chunk of stream) {
  if (isAborted) break;
  
  const content = chunk.choices?.[0]?.delta?.content;
  if (content) {
    process.stdout.write(content);  // No newline
  }
  
  if (chunk.usage) {
    console.log('\nUsage:', chunk.usage);
  }
}

console.log();  // Final newline
