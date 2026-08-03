import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0f',
        foreground: '#f5f5f7'
      }
    }
  },
  plugins: []
};

export default config;
