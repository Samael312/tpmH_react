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
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(-8px) scale(0.98)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-10px)' },
        },
        blob: {
          '0%, 100%': { transform: 'translate(0px, 0px) scale(1)' },
          '33%':      { transform: 'translate(24px, -32px) scale(1.08)' },
          '66%':      { transform: 'translate(-18px, 18px) scale(0.94)' },
        },
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to:   { transform: 'rotate(360deg)' },
        },
        'pop-in': {
          '0%':   { opacity: '0', transform: 'scale(0.85) translateY(6px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
        'toast-in': 'toast-in 0.2s ease-out both',
        float: 'float 5s ease-in-out infinite',
        blob: 'blob 9s ease-in-out infinite',
        'spin-slow': 'spin-slow 14s linear infinite',
        'pop-in': 'pop-in 0.35s ease-out both',
      },
    },
  },
  plugins: [],
}

export default config