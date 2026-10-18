import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

/**
 * Slim Tailwind config (spec §8 — "simple Tailwind, best practices"):
 *  - DEFAULT breakpoints (custom xs/sm/md/lg screens removed → D5)
 *  - all colors alias CSS variables from styles/tokens.css (→ D9, no hex here)
 *  - no dead entries (backgroundImage.canvas dropped; keyframes kept only
 *    while legacy `animate-*` utilities still exist — removed in P6)
 */
const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Legacy brand aliases — token-backed; removed in P6 once the strip
        // phase has eliminated their usage from first-party TSX.
        'primary-500': 'hsl(var(--brand-primary))',
        'primary-600': 'hsl(var(--brand-primary-strong))', // fixes previously-undefined bg-primary-600
        'primary-700': 'hsl(var(--brand-primary-hover))',
        'secondary-500': 'hsl(var(--brand-secondary))',
        'secondary-700': 'hsl(var(--brand-secondary-hover))',
        'base-100': 'hsl(var(--brand-base))',
        'base-200': 'hsl(var(--brand-base-muted))',
        'modal-bg': 'hsl(var(--overlay))',
        'link-bg': 'hsl(var(--brand-link-bg))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        '3xl': 'var(--shadow-3xl)',
        lift: 'var(--shadow-lift)',
        card: 'var(--shadow-card)',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'ui-sans-system', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'rotate(-15deg)' },
          '50%': { transform: 'rotate(15deg)' },
        },
        zoom_in: {
          '0%': { transform: 'scale(0)' },
          '100%': { transform: 'scale(1)' },
        },
        slide_in: {
          '0%': { opacity: '0', transform: 'translate3d(-50%, 0%, 0)' },
          '100%': { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },
      },
      animation: {
        wiggle: 'wiggle 0.3s ease-in-out',
        zoom_in: 'zoom_in 0.3s ease-in-out',
        slide_in: 'slide_in 0.3s ease-in-out',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
