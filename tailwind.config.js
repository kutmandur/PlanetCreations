/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      // Add these two sections for the new animation
      keyframes: {
        'grow-shrink': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.1)' },
        }
      },
      animation: {
        'grow-shrink': 'grow-shrink 2s ease-in-out infinite',
      }
    },
  },
  plugins: [],
}