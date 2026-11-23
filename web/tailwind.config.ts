import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        xs: '380px',
      },
      fontFamily: {
        sans: [
          '"Plus Jakarta Sans"',
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        display: [
          '"Plus Jakarta Sans"',
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          'monospace',
        ],
      },
      colors: {
        app: {
          bg: 'var(--app-bg)',
          surface: 'var(--app-surface)',
          'surface-hover': 'var(--app-surface-hover)',
          input: 'var(--app-input)',
          text: 'var(--app-text)',
          hint: 'var(--app-hint)',
          muted: 'var(--app-muted)',
          accent: 'var(--app-accent)',
          'accent-bright': 'var(--app-accent-bright)',
          'accent-soft': 'var(--app-accent-soft)',
          'accent-border': 'var(--app-accent-border)',
          'accent-text': 'var(--app-accent-text)',
          border: 'var(--app-border)',
          'border-strong': 'var(--app-border-strong)',
          danger: 'var(--app-danger)',
          'danger-soft': 'var(--app-danger-soft)',
        },
      },
      boxShadow: {
        card: 'inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 12px 32px -20px rgba(0, 0, 0, 0.85)',
        float: '0 20px 50px -18px rgba(0, 0, 0, 0.9)',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fade: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translate(-50%, -12px)' },
          to: { opacity: '1', transform: 'translate(-50%, 0)' },
        },
      },
      animation: {
        rise: 'rise 0.32s cubic-bezier(0.22, 1, 0.36, 1) both',
        fade: 'fade 0.2s ease both',
        'toast-in': 'toast-in 0.25s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
} satisfies Config;
