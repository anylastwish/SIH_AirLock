/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        glass: {
          DEFAULT: 'rgba(18, 18, 18, 0.55)',
          soft: 'rgba(18, 18, 18, 0.4)',
          border: 'rgba(255, 255, 255, 0.08)',
        },
        // Point Cloud View (Figma) — neutral grey glass used by the header,
        // toolbar, tilt panel and status bars.
        hud: {
          DEFAULT: 'rgba(117, 117, 117, 0.31)',
          border: 'rgba(117, 117, 117, 0.1)',
          slot: 'rgba(117, 117, 117, 0.09)',
          tilt: 'rgba(37, 37, 37, 0.7)',
        },
        // Point Cloud View — the two side panels (dark blue-grey, translucent).
        pc: {
          panel: 'rgba(22, 26, 29, 0.9)',
          box: 'rgba(10, 14, 16, 0.5)',
          field: 'rgba(34, 40, 44, 0.85)',
          line: 'rgba(255, 255, 255, 0.075)',
          text: '#dcdfe0',
          muted: '#9ba1a5',
          dim: '#687075',
        },
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0, 0, 0, 0.45)',
        glow: '0 0 24px rgba(255, 255, 255, 0.18)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        jersey10: ['"Jersey 10"', 'system-ui', 'sans-serif'],
        jersey15: ['"Jersey 15"', 'system-ui', 'sans-serif'],
        jersey25: ['"Jersey 25"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
