// CareSync Design System - Material Design 3 Inspired
export const colors = {
  // Primary
  primary: '#2B547E',        // Soft Navy - trust
  primaryLight: '#3A6FA0',
  primaryDark: '#1E3D5C',
  primarySurface: '#E8EEF4',

  // Secondary
  secondary: '#87A96B',      // Sage Green - calm
  secondaryLight: '#A3C289',
  secondaryDark: '#6B8A52',
  secondarySurface: '#EDF3E8',

  // Accent / Alert
  accent: '#FF6F61',         // Soft Coral - urgency
  accentLight: '#FF9A90',
  accentDark: '#D4534A',
  accentSurface: '#FFF0EE',

  // Neutrals
  background: '#F8F9FA',
  surface: '#FFFFFF',
  surfaceVariant: '#F1F3F5',
  border: '#E2E5E9',
  borderLight: '#ECEEF0',

  // Text
  textPrimary: '#1A1C1E',
  textSecondary: '#5F6368',
  textTertiary: '#9AA0A6',
  textOnPrimary: '#FFFFFF',
  textOnSecondary: '#FFFFFF',
  textOnAccent: '#FFFFFF',

  // Status
  success: '#34A853',
  successSurface: '#E6F4EA',
  warning: '#FBBC04',
  warningSurface: '#FEF7E0',
  error: '#EA4335',
  errorSurface: '#FCE8E6',
  info: '#4285F4',
  infoSurface: '#E8F0FE',

  // Device status
  online: '#34A853',
  offline: '#EA4335',
  battery: '#87A96B',
};

export const typography = {
  displayLarge: {
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  displayMedium: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 36,
    letterSpacing: -0.3,
  },
  headlineLarge: {
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 32,
  },
  headlineMedium: {
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 28,
  },
  headlineSmall: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  titleLarge: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  titleMedium: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  bodyLarge: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
  },
  bodyMedium: {
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
  bodySmall: {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
  },
  labelLarge: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  labelMedium: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  labelSmall: {
    fontSize: 10,
    fontWeight: '500',
    lineHeight: 14,
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 40,
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 100,
};

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  xl: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
};

export default { colors, typography, spacing, borderRadius, shadows };
