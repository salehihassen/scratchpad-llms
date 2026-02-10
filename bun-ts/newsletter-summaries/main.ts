import { config } from 'dotenv';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import OpenAI from 'openai';
import { z } from 'zod';

config({ path: '../.env' });

// Config
const CONFIG = {
  IMAP_HOST: '127.0.0.1',
  IMAP_PORT: 1143,
  FOLDER_NAME: 'Newsletter_experimental',
  MAX_EMAILS: 10,
  DRY_RUN: process.argv.includes('--dry-run'),
};

// API Key validation
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');

// OpenAI client (via OpenRouter)
const openai = new OpenAI({
  apiKey,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'localhost',
    'X-Title': 'Newsletter Summarizer',
  },
});

// Structured output schema for LLM
const SummaryItemSchema = z.object({
  headline: z.string().describe('One-line takeaway of the email'),
  details: z.string().describe('2-3 sentence summary of key content'),
  relevance_score: z.number().min(1).max(10).describe('How well this aligns with user priorities'),
  urgency_indicator: z.enum(['high', 'medium', 'low', 'none']).describe('Urgency based on time-limits or expirations'),
  source: z.object({
    message_id: z.string().describe('The Message-ID header value'),
    subject: z.string().describe('Email subject line'),
    from: z.string().describe('Sender name/email'),
    date: z.string().describe('Received date'),
  }),
});

const CategorySummarySchema = z.object({
  category: z.enum([
    'AI & Tech Products',
    'Career Opportunities',
    'Financial News',
    'Crazy Deals',
    'Travel Tips',
    'Other',
  ]),
  priority_rank: z.number().min(1).max(6).describe('1 = highest priority'),
  items: z.array(SummaryItemSchema),
});

const SummaryOutputSchema = z.object({
  categories: z.array(CategorySummarySchema),
  executive_summary: z.string().describe('Brief overview of most important items across all categories'),
  recommended_actions: z.array(z.string()).describe('Specific actions the user should take'),
});

type SummaryOutput = z.infer<typeof SummaryOutputSchema>;

// System prompt with priorities
const SYSTEM_PROMPT = `You are an expert email curator and summarizer. Your job is to analyze newsletter emails and extract actionable, high-value information.

USER PRIORITIES (ranked by importance):
1. AI & Tech Products - New AI launches, tools, services, breakthroughs
2. Career Opportunities - Job openings, networking, professional development
3. Financial News - Market updates, investment opportunities, economic trends
4. Crazy Deals - Time-limited offers, exceptional discounts, flash sales
5. Travel Tips - Only exceptional recommendations, unique destinations, mistake fares

CLASSIFICATION RULES:
- For deals: Check if time-limited (urgency = high if expires within 24h, medium if within week)
- For AI/Tech: Prioritize launches over speculation, beta invites, new API announcements
- For Career: Focus on specific job postings over generic advice
- For Travel: Only include if genuinely unique or exceptional value
- Financial: Focus on actionable insights, not general market commentary

OUTPUT REQUIREMENTS:
- Group all items by category
- Include the exact Message-ID from each email for attribution
- Score relevance 1-10 based on user priorities above
- Flag high urgency for time-sensitive deals
- Provide specific recommended actions (e.g., "Apply by Friday", "Check flight deal before midnight")`;

async function summarizeEmails(emailContents: Array<{
  messageId: string;
  subject: string;
  from: string;
  date: Date;
  text: string;
}>): Promise<SummaryOutput> {
  const emailBatch = emailContents.map((e, i) => `
EMAIL ${i + 1}:
Message-ID: ${e.messageId}
Subject: ${e.subject}
From: ${e.from}
Date: ${e.date.toISOString()}
Content:
${e.text.slice(0, 8000)} ${e.text.length > 8000 ? '...(truncated)' : ''}
---`).join('\n');

  const response = await openai.chat.completions.create({
    model: 'anthropic/claude-3.5-sonnet',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Analyze these ${emailContents.length} newsletter emails and provide a structured summary:\n${emailBatch}` },
    ],
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error('No response from LLM');

  // Parse and validate
  const parsed = JSON.parse(content);
  return SummaryOutputSchema.parse(parsed);
}

async function main() {
  console.log(`📧 Newsletter Summarizer${CONFIG.DRY_RUN ? ' [DRY RUN - emails will NOT be marked read]' : ''}\n`);

  const client = new ImapFlow({
    host: CONFIG.IMAP_HOST,
    port: CONFIG.IMAP_PORT,
    secure: false, // Bridge uses STARTTLS
    auth: {
      user: process.env.PROTON_BRIDGE_USER || '',
      pass: process.env.PROTON_BRIDGE_PASS || '',
    },
    logger: false,
  });

  try {
    await client.connect();
    console.log('✅ Connected to ProtonMail Bridge');

    const mailbox = await client.mailboxOpen(CONFIG.FOLDER_NAME);
    console.log(`📂 Opened folder: ${CONFIG.FOLDER_NAME} (${mailbox.exists} total messages)`);

    // Search for unread emails
    const searchResults = await client.search({ unseen: true });
    console.log(`🔍 Found ${searchResults.length} unread emails`);

    if (searchResults.length === 0) {
      console.log('No unread emails to process.');
      return;
    }

    // Get last N unread (most recent)
    const toProcess = searchResults.slice(-CONFIG.MAX_EMAILS);
    console.log(`📝 Processing ${toProcess.length} most recent emails...\n`);

    const processedEmails: Array<{
      uid: number;
      messageId: string;
      subject: string;
      from: string;
      date: Date;
      text: string;
    }> = [];

    for (const uid of toProcess) {
      const message = await client.fetchOne(uid.toString(), {
        source: true,
        envelope: true,
      });

      if (!message.source) continue;

      const parsed = await simpleParser(message.source);
      const text = parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || '';

      processedEmails.push({
        uid,
        messageId: parsed.messageId || uid.toString(),
        subject: parsed.subject || '(No Subject)',
        from: parsed.from?.text || '(Unknown)',
        date: parsed.date || new Date(),
        text,
      });

      console.log(`  📨 ${parsed.subject?.slice(0, 60)}${(parsed.subject?.length || 0) > 60 ? '...' : ''}`);
    }

    // Summarize with LLM
    console.log('\n🤖 Generating summary with AI...\n');
    const summary = await summarizeEmails(processedEmails);

    // Output results
    console.log('═'.repeat(60));
    console.log('📊 EXECUTIVE SUMMARY');
    console.log('═'.repeat(60));
    console.log(summary.executive_summary);
    console.log();

    // Sort categories by priority rank
    const sortedCategories = summary.categories.sort((a, b) => a.priority_rank - b.priority_rank);

    for (const category of sortedCategories) {
      if (category.items.length === 0) continue;

      console.log('─'.repeat(60));
      console.log(`${getCategoryEmoji(category.category)} ${category.category.toUpperCase()}`);
      console.log('─'.repeat(60));

      for (const item of category.items) {
        const urgency = item.urgency_indicator === 'high' ? '🔥' : 
                       item.urgency_indicator === 'medium' ? '⏰' : '';
        
        console.log(`\n  ${urgency} ${item.headline}`);
        console.log(`     ${item.details}`);
        console.log(`     📧 ${item.source.subject}`);
        console.log(`     ✉️  Message-ID: ${item.source.message_id}`);
        console.log(`     📅 ${new Date(item.source.date).toLocaleDateString()}`);
        console.log(`     ⭐ Relevance: ${item.relevance_score}/10`);
      }
    }

    if (summary.recommended_actions.length > 0) {
      console.log('\n' + '═'.repeat(60));
      console.log('✅ RECOMMENDED ACTIONS');
      console.log('═'.repeat(60));
      summary.recommended_actions.forEach((action, i) => {
        console.log(`  ${i + 1}. ${action}`);
      });
    }

    // Mark as read (unless dry run)
    if (!CONFIG.DRY_RUN) {
      console.log('\n📨 Marking processed emails as read...');
      for (const email of processedEmails) {
        await client.messageFlagsAdd(email.uid.toString(), ['\\Seen']);
      }
      console.log(`✅ Marked ${processedEmails.length} emails as read`);
    } else {
      console.log('\n🚫 DRY RUN: Emails were NOT marked as read');
      console.log('   Run without --dry-run to mark as read');
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await client.logout();
    console.log('\n👋 Disconnected');
  }
}

function getCategoryEmoji(category: string): string {
  const map: Record<string, string> = {
    'AI & Tech Products': '🤖',
    'Career Opportunities': '💼',
    'Financial News': '💰',
    'Crazy Deals': '🏷️',
    'Travel Tips': '✈️',
    'Other': '📄',
  };
  return map[category] || '📄';
}

await main();