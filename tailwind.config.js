/** @type {import('tailwindcss').Config} */
module.exports = {
  // REQUIRED for dark mode via `dark:` classes
  darkMode: "class",

  // 🔴 THIS IS CRITICAL — without this, Tailwind generates NO CSS
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],

  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          '"SF Mono"',
          '"Fira Code"',
          'Consolas',
          'monospace',
        ],
      },

      colors: {
        /* App background */
        canvas: {
          light: "#F5F7FA",
          dark: "#060D17",
        },

        /* Cards, panels, tables */
        surface: {
          light: "#FFFFFF",
          dark: "#0F172A",
        },

        /* Borders */
        border: {
          light: "#E2E8F0",
          dark: "#1E293B",
        },
      },

      boxShadow: {
        /* Minimal surface elevation */
        soft: "0 1px 2px rgba(0,0,0,0.04)",
        card: "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)",
        elevated: "0 4px 16px rgba(15,23,42,0.08), 0 1px 4px rgba(15,23,42,0.04)",
        premium: "0 0 0 1px rgba(0,0,0,0.04), 0 8px 32px rgba(15,23,42,0.10)",
        /* Focus rings */
        'focus-indigo': "0 0 0 3px rgba(99,102,241,0.15)",
        'focus-blue': "0 0 0 3px rgba(59,130,246,0.15)",
      },

      borderRadius: {
        xl: "0.75rem",
        '2xl': "1rem",
        '3xl': "1.5rem",
      },

      letterSpacing: {
        tighter: '-0.03em',
        tight: '-0.015em',
      },
    },
  },

  plugins: [],
};
