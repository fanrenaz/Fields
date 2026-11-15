import { ConfigProvider as LobeConfigProvider, MotionProvider, ThemeProvider as LobeThemeProvider } from "@lobehub/ui";
import { StyleProvider } from "antd-style";
import type { ReactNode } from "react";
import { motion } from "motion/react";

import {
  fieldsThemeStyle,
  fieldsThemeToken,
} from "../../shared/theme/palette";

export function FieldsThemeProvider({ children }: { children: ReactNode }) {
  return (
    <LobeConfigProvider motion={motion}>
      <MotionProvider motion={motion}>
        <LobeThemeProvider
          enableCustomFonts={false}
          style={fieldsThemeStyle}
          theme={{ token: fieldsThemeToken }}
          themeMode="light"
        >
          <StyleProvider hashPriority="high">{children}</StyleProvider>
        </LobeThemeProvider>
      </MotionProvider>
    </LobeConfigProvider>
  );
}
