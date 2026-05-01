/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#F97316',
        success: '#22C55E',
        info: '#3B82F6',
        destructive: '#EF4444',
        background: '#1F2937',
        'card-from': '#283548',
        'card-to': '#232f3e',
      },
    },
  },
  plugins: [],
};
