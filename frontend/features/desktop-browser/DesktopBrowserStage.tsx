import { Button, Input, Tooltip } from "@lobehub/ui/base-ui";
import { ArrowLeft, ArrowRight, Globe2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { backendTrpc } from "../../data/boundary/backend-trpc";

const EMPTY_STATE: DesktopBrowserState = {
  activeTabId: null,
  canGoBack: false,
  canGoForward: false,
  tabs: [],
};

export function DesktopBrowserStage({ companyId, actorId, initialUrl, userCode }: { companyId: string; actorId: string; initialUrl?: string; userCode?: string }) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState(EMPTY_STATE);
  const [address, setAddress] = useState(initialUrl ?? "https://auth.openai.com/");
  const [error, setError] = useState<string | null>(null);
  const bridge = window.fieldsDesktop?.browser;

  useEffect(() => bridge?.onState((next) => {
    setState(next);
    const active = next.tabs.find((tab) => tab.id === next.activeTabId);
    if (active?.url) setAddress(active.url);
  }), [bridge]);

  useEffect(() => {
    if (!bridge || !contentRef.current) return;
    let cancelled = false;
    const node = contentRef.current;
    const bounds = () => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const observer = new ResizeObserver(() => bridge.setBounds(bounds()));
    observer.observe(node);
    const clientNonce = randomNonce();
    void backendTrpc.account.desktopBrowser.tunnel.start.mutate({ client_nonce: clientNonce }).then(async (ticket) => {
      if (cancelled) return;
      const websocketUrl = new URL(ticket.websocket_path, window.location.origin);
      websocketUrl.protocol = websocketUrl.protocol === "https:" ? "wss:" : "ws:";
      await bridge.show({
        storagePartition: ticket.storage_partition,
        bounds: bounds(),
        initialUrl,
        tunnel: { websocketUrl: websocketUrl.toString(), token: ticket.token, clientNonce },
      });
      if (!cancelled) setError(null);
    }).catch(() => {
      if (!cancelled) setError(t("desktopBrowser.unavailable"));
    });
    return () => {
      cancelled = true;
      observer.disconnect();
      void bridge.hide();
    };
  }, [actorId, bridge, companyId, initialUrl, t]);

  const navigate = () => {
    const target = normalizedHttpsUrl(address);
    if (!target) {
      setError(t("desktopBrowser.httpsOnly"));
      return;
    }
    setError(null);
    bridge?.navigate(target);
  };

  return (
    <section style={{ background: "var(--ant-color-bg-container)", display: "flex", flex: 1, flexDirection: "column", minHeight: 0 }}>
      <div style={{ alignItems: "center", borderBottom: "1px solid var(--ant-color-border-secondary)", display: "flex", gap: 4, minHeight: 38, overflow: "hidden", padding: "4px 8px" }}>
        {state.tabs.map((tab) => (
          <Button key={tab.id} onClick={() => bridge?.selectTab(tab.id)} size="small" type={tab.id === state.activeTabId ? "primary" : "text"}>
            <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.title || t("desktopBrowser.newTab")}</span>
            <X onClick={(event) => { event.stopPropagation(); bridge?.closeTab(tab.id); }} size={12} />
          </Button>
        ))}
        <Tooltip title={t("desktopBrowser.newTab")}><Button icon={<Plus size={14} />} onClick={() => bridge?.newTab("https://auth.openai.com/")} shape="circle" size="small" type="text" /></Tooltip>
      </div>
      <div style={{ alignItems: "center", borderBottom: "1px solid var(--ant-color-border-secondary)", display: "flex", gap: 6, minHeight: 46, padding: "6px 10px" }}>
        <Button disabled={!state.canGoBack} icon={<ArrowLeft size={15} />} onClick={() => bridge?.back()} shape="circle" size="small" type="text" />
        <Button disabled={!state.canGoForward} icon={<ArrowRight size={15} />} onClick={() => bridge?.forward()} shape="circle" size="small" type="text" />
        <Button icon={<RefreshCw size={15} />} onClick={() => bridge?.reload()} shape="circle" size="small" type="text" />
        <Input prefix={<Globe2 size={14} />} value={address} onChange={(event) => setAddress(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") navigate(); }} />
        <Tooltip title={t("desktopBrowser.clearData")}><Button icon={<Trash2 size={15} />} onClick={() => void bridge?.clearData()} shape="circle" size="small" type="text" /></Tooltip>
        {userCode ? <Button onClick={() => void navigator.clipboard.writeText(userCode)} size="small" type="primary">{userCode}</Button> : null}
      </div>
      {error ? <div role="alert" style={{ color: "var(--ant-color-error)", padding: "8px 12px" }}>{error}</div> : null}
      <div ref={contentRef} style={{ flex: 1, minHeight: 0 }} />
    </section>
  );
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function normalizedHttpsUrl(value: string): string | null {
  try {
    const candidate = value.includes("://") ? value : `https://${value}`;
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
