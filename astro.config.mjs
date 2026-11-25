import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import remarkCjkFriendly from 'remark-cjk-friendly';

export default defineConfig({
  site: 'https://kensetsu-tools.com',
  integrations: [
    tailwind(),
    // 発売時に filter を外す（pc-tenken は noindex・準備中のためサイトマップから除外）
    sitemap({ filter: (page) => !page.includes('/products/pc-tenken/') }),
  ],
  markdown: {
    remarkPlugins: [remarkCjkFriendly],
  },
  output: 'static',
});
