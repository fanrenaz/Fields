import type { CSSProperties } from "react";

export const fieldsPalette = {
  surface: "#FEFEFE",
  ink: "#1B1813",
  muted: "#6B5E56",
  surfaceSoft: "#EFE9E2",
  selection: "#F2E7E3",
  border: "#EAE8E6",
  primary: "#8B493B",
  success: "#24503A",
} as const;

const mix = (foreground: string, amount: number, background: string): string =>
  `color-mix(in srgb, ${foreground} ${amount}%, ${background})`;
const alpha = (color: string, opacity: number): string =>
  `color-mix(in srgb, ${color} ${opacity}%, transparent)`;

export const fieldsDerivedColors = {
  borderStrong: mix(fieldsPalette.ink, 18, fieldsPalette.surface),
  inkAlpha3: alpha(fieldsPalette.ink, 3),
  inkAlpha7: alpha(fieldsPalette.ink, 7),
  inkAlpha8: alpha(fieldsPalette.ink, 8),
  mutedText: alpha(fieldsPalette.muted, 68),
  primaryActive: mix(fieldsPalette.primary, 82, fieldsPalette.ink),
  primaryBorder: mix(fieldsPalette.primary, 25, fieldsPalette.surface),
  primaryHover: mix(fieldsPalette.primary, 90, fieldsPalette.ink),
  primaryShadow: alpha(fieldsPalette.primary, 18),
  surfaceAlpha8: alpha(fieldsPalette.surface, 8),
  surfaceAlpha12: alpha(fieldsPalette.surface, 12),
  surfaceAlpha24: alpha(fieldsPalette.surface, 24),
  surfaceAlpha94: alpha(fieldsPalette.surface, 94),
} as const;

const semanticState = {
  colorError: fieldsPalette.primary,
  colorErrorActive: fieldsDerivedColors.primaryActive,
  colorErrorBg: fieldsPalette.selection,
  colorErrorBgActive: fieldsPalette.selection,
  colorErrorBgHover: fieldsPalette.selection,
  colorErrorBorder: fieldsDerivedColors.primaryBorder,
  colorErrorBorderHover: fieldsPalette.primary,
  colorErrorHover: fieldsDerivedColors.primaryHover,
  colorErrorText: fieldsPalette.primary,
  colorErrorTextActive: fieldsDerivedColors.primaryActive,
  colorErrorTextHover: fieldsDerivedColors.primaryHover,
  colorWarning: fieldsPalette.primary,
  colorWarningActive: fieldsDerivedColors.primaryActive,
  colorWarningBg: fieldsPalette.selection,
  colorWarningBgHover: fieldsPalette.selection,
  colorWarningBorder: fieldsDerivedColors.primaryBorder,
  colorWarningBorderHover: fieldsPalette.primary,
  colorWarningHover: fieldsDerivedColors.primaryHover,
  colorWarningText: fieldsPalette.primary,
  colorWarningTextActive: fieldsDerivedColors.primaryActive,
  colorWarningTextHover: fieldsDerivedColors.primaryHover,
} as const;

export const fieldsThemeToken = {
  ...semanticState,
  borderRadius: 10,
  colorBgBase: fieldsPalette.surface,
  colorBgContainer: fieldsPalette.surface,
  colorBgElevated: fieldsPalette.surface,
  colorBgLayout: fieldsPalette.surface,
  colorBgSpotlight: fieldsPalette.ink,
  colorBorder: fieldsPalette.border,
  colorBorderSecondary: fieldsPalette.border,
  colorFill: fieldsPalette.surfaceSoft,
  colorFillSecondary: fieldsPalette.surfaceSoft,
  colorFillTertiary: fieldsPalette.surfaceSoft,
  colorFillQuaternary: fieldsPalette.selection,
  colorInfo: fieldsPalette.primary,
  colorLink: fieldsPalette.primary,
  colorLinkActive: fieldsDerivedColors.primaryActive,
  colorLinkHover: fieldsDerivedColors.primaryHover,
  colorPrimary: fieldsPalette.primary,
  colorPrimaryActive: fieldsDerivedColors.primaryActive,
  colorPrimaryBg: fieldsPalette.selection,
  colorPrimaryBgHover: fieldsPalette.selection,
  colorPrimaryBorder: fieldsDerivedColors.primaryBorder,
  colorPrimaryBorderHover: fieldsPalette.primary,
  colorPrimaryHover: fieldsDerivedColors.primaryHover,
  colorPrimaryText: fieldsPalette.primary,
  colorPrimaryTextActive: fieldsDerivedColors.primaryActive,
  colorPrimaryTextHover: fieldsDerivedColors.primaryHover,
  colorSuccess: fieldsPalette.success,
  colorText: fieldsPalette.ink,
  colorTextBase: fieldsPalette.ink,
  colorTextHeading: fieldsPalette.ink,
  colorTextLabel: fieldsPalette.muted,
  colorTextLightSolid: fieldsPalette.surface,
  colorTextSecondary: fieldsPalette.muted,
  colorTextTertiary: fieldsDerivedColors.mutedText,
  colorTextQuaternary: fieldsDerivedColors.mutedText,
  controlItemBgActive: fieldsPalette.selection,
  controlItemBgHover: fieldsPalette.surfaceSoft,
  controlOutline: fieldsDerivedColors.primaryBorder,
  fontFamily: "Instrument Sans, Inter, ui-sans-serif, system-ui, sans-serif",
} as const;

type ThemeStyle = CSSProperties & Record<`--${string}`, string | number>;

const antColorVariables = Object.fromEntries(
  Object.entries(fieldsThemeToken)
    .filter(([token, value]) => (
      typeof value === "string"
      && (token.startsWith("color") || token.startsWith("control"))
    ))
    .map(([token, value]) => [
      `--ant-${token.replaceAll(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`)}`,
      value,
    ]),
) as Record<`--ant-${string}`, string>;

/**
 * The Theme Provider is the only runtime color outlet. Ant/Lobe components
 * consume the bridged Ant variables; product CSS uses the stable Fields
 * variables when a palette role has no matching Ant semantic token.
 */
export const fieldsThemeStyle: Readonly<ThemeStyle> = Object.freeze({
  ...antColorVariables,
  color: "var(--ant-color-text)",
  "--fields-color-border": fieldsPalette.border,
  "--fields-color-ink": fieldsPalette.ink,
  "--fields-color-muted": fieldsPalette.muted,
  "--fields-color-primary": fieldsPalette.primary,
  "--fields-color-selection": fieldsPalette.selection,
  "--fields-color-success": fieldsPalette.success,
  "--fields-color-surface": fieldsPalette.surface,
  "--fields-color-surface-soft": fieldsPalette.surfaceSoft,
});
