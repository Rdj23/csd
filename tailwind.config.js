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
      colors: {
        /* App background */
        canvas: {
          light: "#F8FAFC", // light mode app bg
          dark: "#020617",  // dark mode deep navy
        },

        /* Cards, panels, tables */
        surface: {
          light: "#FFFFFF",
          dark: "#0F172A", // slate-900
        },

        /* Borders */
        border: {
          light: "#E2E8F0", // slate-200
          dark: "#334155",  // slate-700
        },
      },

      /* Optional but recommended */
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.04)",
        card: "0 8px 24px rgba(15,23,42,0.08)",
      },

      borderRadius: {
        xl: "0.75rem",
      },
    },
  },

  plugins: [],
};
