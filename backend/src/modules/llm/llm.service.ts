import { SummaryType, Urgency } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { env } from '../../config/env';
import { generateText } from './gemini.client';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildPreVisitPrompt(symptoms: string): string {
  return `Analyse these symptoms and return ONLY a JSON object (no markdown, no code fences) with exactly these keys:
{
  "urgency": "Low" | "Medium" | "High",
  "chiefComplaint": string,
  "suggestedQuestions": [string, string, string]
}
Symptoms: ${symptoms}`;
}

function buildPostVisitPrompt(clinicalNotes: string): string {
  return `Convert these clinical notes into a patient-friendly summary. Return ONLY a JSON object (no markdown, no code fences) with exactly these keys:
{
  "patientSummary": string,
  "medicationSchedule": [{ "medication": string, "schedule": string }],
  "followUpInstructions": string
}
Clinical notes: ${clinicalNotes}`;
}

function extractJson(raw: string): unknown {
  // Gemini sometimes wraps JSON in ```json fences despite instructions - strip them defensively.
  const cleaned = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

async function callWithRetry(prompt: string): Promise<{ text: string } | { error: string }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const text = await generateText(prompt);
      return { text };
    } catch (err) {
      lastError = err;
      logger.warn({ err, attempt }, 'LLM call failed, will retry if attempts remain');
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  return { error: lastError instanceof Error ? lastError.message : 'Unknown LLM error' };
}

export const llmService = {
  /**
   * Generates a pre-visit AI summary for the doctor. Never throws: on any
   * failure (missing API key, network error, malformed JSON), it persists a
   * `failed` AISummary row so the booking flow and doctor dashboard can
   * continue functioning, and the doctor sees "summary unavailable" instead
   * of a crash.
   */
  async generatePreVisitSummary(appointmentId: string, symptoms: string) {
    const result = await callWithRetry(buildPreVisitPrompt(symptoms));

    if ('error' in result) {
      return prisma.aISummary.create({
        data: {
          appointmentId,
          type: SummaryType.PRE_VISIT,
          model: env.GEMINI_MODEL,
          failed: true,
          errorMessage: result.error,
        },
      });
    }

    try {
      const parsed = extractJson(result.text) as {
        urgency: string;
        chiefComplaint: string;
        suggestedQuestions: string[];
      };
      const urgency = normalizeUrgency(parsed.urgency);

      return prisma.aISummary.create({
        data: {
          appointmentId,
          type: SummaryType.PRE_VISIT,
          urgency,
          chiefComplaint: parsed.chiefComplaint,
          suggestedQuestions: parsed.suggestedQuestions ?? [],
          rawResponse: result.text,
          model: env.GEMINI_MODEL,
          failed: false,
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to parse pre-visit LLM response as JSON');
      return prisma.aISummary.create({
        data: {
          appointmentId,
          type: SummaryType.PRE_VISIT,
          rawResponse: result.text,
          model: env.GEMINI_MODEL,
          failed: true,
          errorMessage: 'Could not parse LLM response',
        },
      });
    }
  },

  async generatePostVisitSummary(appointmentId: string, clinicalNotes: string) {
    const result = await callWithRetry(buildPostVisitPrompt(clinicalNotes));

    if ('error' in result) {
      return prisma.aISummary.create({
        data: {
          appointmentId,
          type: SummaryType.POST_VISIT,
          model: env.GEMINI_MODEL,
          failed: true,
          errorMessage: result.error,
        },
      });
    }

    try {
      const parsed = extractJson(result.text) as {
        patientSummary: string;
        medicationSchedule: unknown;
        followUpInstructions: string;
      };

      return prisma.aISummary.create({
        data: {
          appointmentId,
          type: SummaryType.POST_VISIT,
          patientSummary: parsed.patientSummary,
          medicationSchedule: parsed.medicationSchedule as object,
          followUpInstructions: parsed.followUpInstructions,
          rawResponse: result.text,
          model: env.GEMINI_MODEL,
          failed: false,
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to parse post-visit LLM response as JSON');
      return prisma.aISummary.create({
        data: {
          appointmentId,
          type: SummaryType.POST_VISIT,
          rawResponse: result.text,
          model: env.GEMINI_MODEL,
          failed: true,
          errorMessage: 'Could not parse LLM response',
        },
      });
    }
  },
};

function normalizeUrgency(value: string): Urgency {
  const v = value?.toLowerCase();
  if (v === 'high') return Urgency.HIGH;
  if (v === 'medium') return Urgency.MEDIUM;
  return Urgency.LOW;
}
