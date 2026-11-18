import { z } from 'zod';

export const MAX_TOPICS = 10;

export const createTopicSchema = z.object({
  name: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(
      z
        .string()
        .min(1)
        .max(40)
        .regex(/^[a-z0-9][a-z0-9 .+#-]*$/),
    ),
});

export const replaceTopicsSchema = z.object({
  names: z.array(createTopicSchema.shape.name).min(1),
});

export const topicIdSchema = z.coerce.number().int().positive();

export type CreateTopicDto = z.infer<typeof createTopicSchema>;

export type ReplaceTopicsDto = z.infer<typeof replaceTopicsSchema>;

export interface TopicDto {
  id: number;
  name: string;
  createdAt: string;
}

export const TOPIC_SUGGESTIONS: readonly string[] = [
  'react',
  'typescript',
  'javascript',
  'rust',
  'go',
  'python',
  'ai',
  'machine learning',
  'nodejs',
  'devops',
  'kubernetes',
  'docker',
  'css',
  'web performance',
  'security',
  'databases',
];
