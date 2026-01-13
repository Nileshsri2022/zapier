import type { Config } from "tailwindcss";

export default {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "primary-500": "#FF4F00",
        "primary-700": "#CC3F00",
        "base-100": "#FFFDF9",
        "base-200": "#F5F3EB",
        "secondary-500": "#695BE8",
        "secondary-700": "#503EBD",
        "modal-bg": "rgb(0, 0, 0, 0.2)",
        "link-bg": "#F7F6FD"
      },
      boxShadow: {
        "3xl": "0px 5px 10px 7px rgb(0, 0, 0, 0.1)"
      },
      backgroundImage: {
        "canvas" : "radial-gradient(black 1px, transparent 0)"
      },
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'rotate(-15deg)' },
          '50%': { transform: 'rotate(15deg)' },
        },
        zoom_in: {
          '0%': {transform: 'scale(0)'},
          "100%": {transform: 'scale(1)'}
        },
        slide_in: {
          "0%": {opacity: '0', transform: "translate3d(-50%, 0%, 0)"},
          "100%": {opacity: '1', transform: "translate3d(0%, 0%, 0)"}
        }
      },
      animation: {
        wiggle: 'wiggle 0.3s ease-in-out',
        zoom_in: 'zoom_in 0.3s ease-in-out',
        slide_in: 'slide_in 0.3s ease-in-out'
      }
    },
  },
  plugins: [],
} satisfies Config;
