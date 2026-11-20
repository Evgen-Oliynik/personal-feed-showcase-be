import { z } from 'zod';
import { MAX_TOPICS } from '../topics/topics.schema.js';

export const MAX_HISTORY = 12;

export const historyMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

export const chatSchema = z.object({
  question: z.string().trim().min(1).max(500),
  topics: z.array(z.string()).max(MAX_TOPICS).default([]),
  history: z.array(historyMessageSchema).max(MAX_HISTORY).default([]),
});

export type ChatDto = z.infer<typeof chatSchema>;
