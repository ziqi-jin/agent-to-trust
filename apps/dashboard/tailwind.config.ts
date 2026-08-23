import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        abyss: '#0B0E14',
        surface: '#141A24',
        edge: '#232B3A',
        accent: '#34D399',
        info: '#60A5FA',
        danger: '#F87171',
        amber: '#F4A261',
        bright: '#E6EAF2',
        dim: '#8A94A6',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
