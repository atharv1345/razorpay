/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#070b12',
          900: '#0c1220',
          800: '#121a2b',
          700: '#1a2438',
        },
        mint: {
          400: '#3dffa8',
          500: '#1ad48a',
        },
        amber: {
          glow: '#f5b942',
        },
        coral: {
          alert: '#ff6b4a',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        body: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        panel: '0 0 0 1px rgba(61,255,168,0.08), 0 20px 50px rgba(0,0,0,0.45)',
      },
    },
  },
  plugins: [],
};
