import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  const sorted = posts.sort(
    (a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf()
  );

  return rss({
    title: '建設業ツール工房',
    description: '建設業の現場を、もっとシンプルに。法令対応・業務ツール・テンプレート・業界情報を提供します。',
    site: context.site!,
    items: sorted.map(post => ({
      title: post.data.title,
      pubDate: post.data.publishedAt,
      description: post.data.description,
      link: `/blog/${post.slug}/`,
    })),
    customData: `<language>ja</language>`,
  });
}
