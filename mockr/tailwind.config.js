/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: '#7c3aed', dark: '#6d28d9', light: '#f3e8ff' },
        repost: '#059669',
      },
    },
  },
  plugins: [],
};
