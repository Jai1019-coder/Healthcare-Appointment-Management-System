import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env';

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI | null {
  if (!env.GEMINI_API_KEY) return null;
  if (!client) client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  return client;
}

/**
 * Calls Gemini with a plain-text prompt and returns the raw text response.
 * Throws on failure - callers (llm.service) are responsible for retry logic
 * and for degrading gracefully so the rest of the system keeps working.
 */
export async function generateText(prompt: string): Promise<string> {
  const genAI = getClient();
  if (!genAI) throw new Error('GEMINI_API_KEY is not configured');

  const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });
  const result = await model.generateContent(prompt);
  return result.response.text();
}
