/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        panel: 'var(--bg-panel)',
        inset: 'var(--bg-inset)',
        hover: 'var(--bg-hover)',
        selected: 'var(--bg-selected)',
        border: 'var(--border)',
        fg: 'var(--fg)',
        muted: 'var(--fg-muted)',
        accent: 'var(--accent)',
        'accent-fg': 'var(--accent-fg)',
        good: 'var(--quality-good)',
        'good-bg': 'var(--quality-good-bg)',
        bad: 'var(--quality-bad)',
        'bad-bg': 'var(--quality-bad-bg)',
        uncertain: 'var(--quality-uncertain)',
        'uncertain-bg': 'var(--quality-uncertain-bg)',
      },
      fontFamily: {
        sans: ['system-ui', 'Inter', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', '"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      borderRadius: {
        sm: '2px',
        DEFAULT: '3px',
      },
    },
  },
  plugins: [],
};
