/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: '#0f9d8a', dark: '#0b7a6b', light: '#e6f6f3' },
        down: '#5b6ee1',
      },
    },
  },
  plugins: [],
};
