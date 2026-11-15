import { ToastHost, useToast } from "@lobehub/ui";
import { useCallback, useMemo } from "react";

export type AppToastTone = "info" | "success" | "error";

export type AppToastActions = {
  info(title: string, message?: string): void;
  success(title: string, message?: string): void;
  error(title: string, message?: string): void;
};

export function useAppToast(): AppToastActions {
  const toast = useToast();

  const show = useCallback((title: string, message: string | undefined, tone: AppToastTone) => {
    toast[tone]({
      description: message,
      duration: tone === "error" ? 6_000 : 4_200,
      title,
    });
  }, [toast]);

  return useMemo(() => ({
    info(title, message) {
      show(title, message, "info");
    },
    success(title, message) {
      show(title, message, "success");
    },
    error(title, message) {
      show(title, message, "error");
    },
  }), [show]);
}

export function AppToastHost() {
  return <ToastHost duration={4_200} />;
}
