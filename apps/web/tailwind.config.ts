import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0f',
        foreground: '#f5f5f7',
        // Retro terminal system (apps/web/design.md), scoped to .terminal-theme
        // pages only. Wired via CSS custom properties so they only resolve
        // inside that scope, never bleeding into the public site's colors.
        term: {
          canvas: 'var(--color-canvas)',
          surface: 'var(--color-surface)',
          border: 'var(--color-border)',
          muted: 'var(--color-muted)',
          body: 'var(--color-body)',
          ink: 'var(--color-ink)',
          accent: 'var(--color-accent)',
          'on-accent': 'var(--color-on-accent)',
          success: 'var(--color-success)',
          error: 'var(--color-error)'
        }
      },
      fontFamily: {
        mono: ['var(--font-mono)']
      },
      fontSize: {
        'term-xs': 'var(--text-xs)',
        'term-sm': 'var(--text-sm)',
        'term-base': 'var(--text-base)',
        'term-lg': 'var(--text-lg)',
        'term-xl': 'var(--text-xl)',
        'term-2xl': 'var(--text-2xl)',
        'term-3xl': 'var(--text-3xl)',
        'term-4xl': 'var(--text-4xl)'
      },
      borderRadius: {
        'term-sm': 'var(--radius-sm)',
        'term-md': 'var(--radius-md)'
      },
      transitionDuration: {
        'term-instant': 'var(--duration-instant)',
        'term-base': 'var(--duration-base)',
        'term-slow': 'var(--duration-slow)'
      }
    }
  },
  plugins: []
};

export default config;
