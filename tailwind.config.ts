import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Portal accents: university = deep blue, student = green, employer = amber
        university: {
          50: "#eef4ff",
          100: "#dae6ff",
          200: "#bcd3ff",
          400: "#5b8def",
          600: "#1e46a8",
          700: "#173a8c",
          900: "#0d2154",
        },
        student: {
          50: "#eefbf3",
          100: "#d5f5e2",
          200: "#aeead0",
          400: "#3fb27a",
          600: "#12784b",
          700: "#0d5f3c",
          900: "#06331f",
        },
        employer: {
          50: "#fff8ec",
          100: "#ffefd2",
          200: "#ffdfa6",
          400: "#f0a02c",
          600: "#b96c05",
          700: "#94550a",
          900: "#4d2c05",
        },
        ink: {
          DEFAULT: "#12151c",
          soft: "#3d4552",
          faint: "#6b7484",
        },
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
