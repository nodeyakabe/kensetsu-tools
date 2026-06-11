import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        accent: {
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
        },
      },
      fontFamily: {
        sans: [
          '"Noto Sans JP"',
          '"Hiragino Kaku Gothic ProN"',
          '"Hiragino Sans"',
          'Meiryo',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'monospace',
        ],
      },
      typography: (theme) => ({
        DEFAULT: {
          css: {
            color: '#1e293b',
            maxWidth: 'none',
            a: {
              color: theme('colors.primary.600'),
              textDecoration: 'none',
              '&:hover': {
                color: theme('colors.primary.800'),
                textDecoration: 'underline',
              },
            },
            h1: { color: theme('colors.primary.900') },
            h2: { color: theme('colors.primary.800') },
            h3: { color: theme('colors.primary.800') },
            'code::before': { content: 'none' },
            'code::after':  { content: 'none' },
            code: {
              color: theme('colors.primary.700'),
              backgroundColor: theme('colors.primary.50'),
              padding: '0.125rem 0.375rem',
              borderRadius: '0.25rem',
              fontWeight: '400',
            },
            blockquote: {
              borderLeftColor: theme('colors.primary.400'),
              color: theme('colors.slate.600'),
            },
          },
        },
      }),
    },
  },
  plugins: [typography],
};
