/**
 * DESIGN TOKENS - Support Dashboard
 * Premium color system, typography, and spacing tokens
 * Created by: Senior Principal Designer
 */

export const colors = {
  // Primary Brand Colors - More sophisticated purple-blue gradient
  primary: {
    50: '#f5f3ff',
    100: '#ede9fe',
    200: '#ddd6fe',
    300: '#c4b5fd',
    400: '#a78bfa',
    500: '#8b5cf6',  // Main brand color
    600: '#7c3aed',
    700: '#6d28d9',
    800: '#5b21b6',
    900: '#4c1d95',
  },

  // Accent Colors - Refined and purposeful
  accent: {
    blue: '#3b82f6',      // Information, FRT
    emerald: '#10b981',   // Success, CSAT
    amber: '#f59e0b',     // Warning, FRR
    rose: '#f43f5e',      // Error, negative metrics
    purple: '#8b5cf6',    // Premium, primary actions
    cyan: '#06b6d4',      // Secondary info
  },

  // Semantic Colors
  success: {
    light: '#d1fae5',
    main: '#10b981',
    dark: '#065f46',
  },
  warning: {
    light: '#fef3c7',
    main: '#f59e0b',
    dark: '#92400e',
  },
  error: {
    light: '#fee2e2',
    main: '#ef4444',
    dark: '#991b1b',
  },
  info: {
    light: '#dbeafe',
    main: '#3b82f6',
    dark: '#1e40af',
  },

  // Neutral Palette - Warmer, more sophisticated
  neutral: {
    0: '#ffffff',
    50: '#fafaf9',   // Warmer than pure gray
    100: '#f5f5f4',
    200: '#e7e5e4',
    300: '#d6d3d1',
    400: '#a8a29e',
    500: '#78716c',
    600: '#57534e',
    700: '#44403c',
    800: '#292524',
    900: '#1c1917',
    950: '#0c0a09',
  },

  // Glass/Translucent effects
  glass: {
    light: 'rgba(255, 255, 255, 0.8)',
    lightHover: 'rgba(255, 255, 255, 0.9)',
    dark: 'rgba(15, 23, 42, 0.8)',
    darkHover: 'rgba(15, 23, 42, 0.9)',
  },
};

export const typography = {
  // Font Families
  fontFamily: {
    sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    mono: '"JetBrains Mono", "Fira Code", "SF Mono", Consolas, monospace',
    display: '"Cal Sans", "Inter", sans-serif', // For hero text
  },

  // Font Sizes (Fluid Typography)
  fontSize: {
    xs: '0.75rem',      // 12px
    sm: '0.875rem',     // 14px
    base: '1rem',       // 16px
    lg: '1.125rem',     // 18px
    xl: '1.25rem',      // 20px
    '2xl': '1.5rem',    // 24px
    '3xl': '1.875rem',  // 30px
    '4xl': '2.25rem',   // 36px
    '5xl': '3rem',      // 48px
  },

  // Font Weights
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
  },

  // Line Heights
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },

  // Letter Spacing
  letterSpacing: {
    tighter: '-0.05em',
    tight: '-0.025em',
    normal: '0',
    wide: '0.025em',
    wider: '0.05em',
    widest: '0.1em',
  },
};

export const spacing = {
  // Base unit: 4px
  0: '0',
  1: '0.25rem',   // 4px
  2: '0.5rem',    // 8px
  3: '0.75rem',   // 12px
  4: '1rem',      // 16px
  5: '1.25rem',   // 20px
  6: '1.5rem',    // 24px
  8: '2rem',      // 32px
  10: '2.5rem',   // 40px
  12: '3rem',     // 48px
  16: '4rem',     // 64px
  20: '5rem',     // 80px
  24: '6rem',     // 96px
};

export const borderRadius = {
  none: '0',
  sm: '0.375rem',    // 6px
  DEFAULT: '0.5rem',  // 8px
  md: '0.75rem',     // 12px
  lg: '1rem',        // 16px
  xl: '1.5rem',      // 24px
  '2xl': '2rem',     // 32px
  full: '9999px',
};

export const shadows = {
  // Elevated shadows for premium feel
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  DEFAULT: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  md: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  lg: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  xl: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',

  // Colored shadows for depth
  glow: {
    purple: '0 0 20px rgba(139, 92, 246, 0.3)',
    blue: '0 0 20px rgba(59, 130, 246, 0.3)',
    emerald: '0 0 20px rgba(16, 185, 129, 0.3)',
  },
};

export const animation = {
  // Smooth, professional animations
  duration: {
    fast: '150ms',
    DEFAULT: '250ms',
    slow: '350ms',
    slower: '500ms',
  },

  easing: {
    DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)', // Bouncy spring
  },
};

export const glassmorphism = {
  light: {
    background: 'rgba(255, 255, 255, 0.7)',
    border: 'rgba(255, 255, 255, 0.3)',
    backdropFilter: 'blur(16px) saturate(180%)',
  },
  dark: {
    background: 'rgba(15, 23, 42, 0.7)',
    border: 'rgba(255, 255, 255, 0.1)',
    backdropFilter: 'blur(16px) saturate(180%)',
  },
};
