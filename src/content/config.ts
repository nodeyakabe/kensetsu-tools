import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    category: z.string().default('その他'),
    tags: z.array(z.string()).default([]),
    heroImage: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
