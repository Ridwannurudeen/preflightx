import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0A0B0E",
        surface: "#0F1115",
        card: "#14161B",
        elevated: "#1A1D23",
        border: "#22262E",
        "border-strong": "#2D323C",
        text: "#E8ECF2",
        muted: "#8A93A6",
        subtle: "#5C6578",
        ok: "#00E08F",
        "ok-dim": "#00A86B",
        bad: "#FF5A5F",
        "bad-dim": "#C23F44",
        warn: "#FFB547",
        accent: "#00E08F",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: [
          "var(--font-jetbrains)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      letterSpacing: {
        tightest: "-0.04em",
        tighter: "-0.02em",
      },
      animation: {
        "pulse-slow": "pulse 3s ease-in-out infinite",
        "fade-in": "fadeIn 0.4s ease-out forwards",
        "slide-down": "slideDown 0.3s ease-out forwards",
        "digit-roll": "digitRoll 0.5s ease-out",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideDown: {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        digitRoll: {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(to right, rgba(34, 38, 46, 0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(34, 38, 46, 0.35) 1px, transparent 1px)",
        "radial-glow":
          "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0, 224, 143, 0.12), transparent 70%)",
      },
    },
  },
  plugins: [],
};

export default config;
