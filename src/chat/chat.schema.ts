import { z } from 'zod';

export const chatSchema = z.object({
  question: z.string().trim().min(1).max(500),
});

export type ChatDto = z.infer<typeof chatSchema>;
