import { AppToastHost } from "./app/providers/toast";
import { FieldsThemeProvider } from "./app/providers/theme";
import { DesktopUpdatePrompt } from "./app/desktop/DesktopUpdatePrompt";
import { ClientRouter } from "./app/client/ClientRouter";
import { RootApp } from "./app/workspace/RootApp";
import { I18nProvider } from "./shared/i18n";

export default function App() {
  return (
    <FieldsThemeProvider>
      <I18nProvider>
        {import.meta.env.MODE === "pwa" ? <ClientRouter /> : <RootApp />}
        {import.meta.env.MODE !== "pwa" && window.fieldsDesktop ? <DesktopUpdatePrompt /> : null}
        <AppToastHost />
      </I18nProvider>
    </FieldsThemeProvider>
  );
}
