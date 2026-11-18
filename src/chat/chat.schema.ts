import { z } from 'zod';
import { MAX_TOPICS } from '../topics/topics.schema.js';

export const chatSchema = z.object({
  question: z.string().trim().min(1).max(500),
  topics: z.array(z.string()).max(MAX_TOPICS).default([]),
});

export type ChatDto = z.infer<typeof chatSchema>;
