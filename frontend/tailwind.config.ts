import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#E91E8C',
          light:   '#F06DB3',
          dark:    '#C0166F',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          soft:    '#F8F9FA',
          muted:   '#F1F3F5',
        },
        ink: {
          DEFAULT: '#1a1a2e',
          muted:   '#6B7280',
          subtle:  '#9CA3AF',
        },
        accent: {
          green:  '#22C55E',
          purple: '#9333EA',
          blue:   '#3B82F6',
          amber:  '#F59E0B',
          red:    '#EF4444',
        }
      },
      fontFamily: {
        sans:    ['DM Sans', 'sans-serif'],
        display: ['Poppins', 'sans-serif'],
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
      },
    },
  },
  plugins: [],
}

export default config