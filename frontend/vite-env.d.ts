/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIELDS_BACKEND_TRPC_URL?: string;
  readonly VITE_FIELDS_DESKTOP_VERSION?: string;
  readonly VITE_FIELDS_HOME_TURN_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type DesktopBrowserState = {
  activeTabId: number | null;
  canGoBack: boolean;
  canGoForward: boolean;
  tabs: Array<{ id: number; title: string; url: string; loading: boolean }>;
};

interface Window {
  fieldsDesktop?: {
    runtime: {
      markHealthy(): Promise<boolean>;
    };
    telemetry: {
      authenticated(active: boolean): Promise<void>;
    };
    browser: {
      show(input: { storagePartition: string; bounds: DOMRectLike; initialUrl?: string; tunnel: { websocketUrl: string; token: string; clientNonce: string } }): Promise<void>;
      hide(): Promise<void>;
      setBounds(bounds: DOMRectLike): void;
      navigate(url: string): void;
      back(): void;
      forward(): void;
      reload(): void;
      newTab(url?: string): void;
      selectTab(id: number): void;
      closeTab(id: number): void;
      clearData(): Promise<void>;
      onState(callback: (state: DesktopBrowserState) => void): () => void;
    };
    settings: {
      get(): Promise<DesktopSettings>;
      update(input: Partial<DesktopSettings>): Promise<DesktopSettings>;
      onChanged(callback: (settings: DesktopSettings) => void): () => void;
    };
    notifications: {
      show(input: DesktopNativeNotification): Promise<boolean>;
    };
    updates: {
      getState(): Promise<DesktopUpdateState | null>;
      download(): Promise<void>;
      cancel(): Promise<void>;
      install(): Promise<boolean>;
      onState(callback: (state: DesktopUpdateState) => void): () => void;
    };
    navigation: { onOpen(callback: (destination: DesktopNavigationDestination) => void): () => void };
  };
}

type DesktopSettings = { launchAtLogin: boolean; notificationsEnabled: boolean };
type DesktopNavigationDestination = { kind: "room"; roomId: string; messageId: string } | { kind: "home"; threadId: string };
type DesktopNativeNotification = { eventId: string; title: string; body: string; destination: DesktopNavigationDestination };
type DesktopUpdateState =
  | { status: "available"; currentVersion: string; releaseId: string; releaseSequence: number }
  | { status: "downloading"; receivedBytes: number; totalBytes: number }
  | { status: "ready"; releaseId: string; releaseSequence: number }
  | { status: "error"; operation: "download" | "install" };

type DOMRectLike = { x: number; y: number; width: number; height: number };
