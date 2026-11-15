import { useCallback, useEffect, useState } from "react";

import { backendTrpc } from "../data/boundary/backend-trpc";
import type { Locale } from "../shared/i18n/locale";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export function useMobileCapabilities(locale: Locale) {
  const [permission, setPermission] = useState<NotificationPermission>(() => typeof Notification === "undefined" ? "denied" : Notification.permission);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [notificationPrompt, setNotificationPrompt] = useState(() => permission === "default" && localStorage.getItem("fields.mobile.notification-prompt.v1") !== "dismissed");
  const [notificationError, setNotificationError] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const iosInstallGuide = /iPad|iPhone|iPod/u.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone;

  useEffect(() => {
    const onPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const reconcileNotifications = useCallback(async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission !== "granted") return;
    setNotificationBusy(true);
    setNotificationError(false);
    try {
      const registration = await navigator.serviceWorker.ready;
      const { public_key } = await backendTrpc.notifications.push.publicKey.query();
      const subscription = await registration.pushManager.getSubscription()
        ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey(public_key) });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("push_subscription_invalid");
      await backendTrpc.notifications.push.subscriptions.upsert.mutate({
        endpoint: json.endpoint,
        expiration_time_ms: json.expirationTime ?? null,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        locale,
      });
    } catch {
      setNotificationError(true);
    } finally {
      setNotificationBusy(false);
    }
  }, [locale]);

  useEffect(() => { if (permission === "granted") void reconcileNotifications(); }, [permission, reconcileNotifications]);

  const enableNotifications = useCallback(async () => {
    if (!("Notification" in window)) return;
    setNotificationBusy(true);
    setNotificationError(false);
    try {
      const next = await Notification.requestPermission();
      setPermission(next);
      setNotificationPrompt(false);
    } catch {
      setNotificationError(true);
    } finally {
      setNotificationBusy(false);
    }
  }, []);

  return {
    permission,
    notificationPrompt,
    dismissNotificationPrompt: () => { localStorage.setItem("fields.mobile.notification-prompt.v1", "dismissed"); setNotificationPrompt(false); },
    enableNotifications,
    reconcileNotifications,
    notificationBusy,
    notificationError,
    canInstall: installPrompt !== null,
    install: async () => { if (!installPrompt) return; await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null); },
    iosInstallGuide,
  };
}

function vapidKey(value: string): ArrayBuffer {
  const padded = `${value.replace(/-/gu, "+").replace(/_/gu, "/")}${"=".repeat((4 - value.length % 4) % 4)}`;
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}
