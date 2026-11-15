import type { CompanyTerminalSummary } from "@fields/contracts/public/embodiment";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, RefreshCw, ShieldOff, Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, Block, Flexbox, Skeleton, Text } from "@lobehub/ui";
import { Button, Input, Modal } from "@lobehub/ui/base-ui";

import { TerminalApiError, claimTerminal, listTerminals, revokeTerminal, rotateTerminal } from "../../data/account/terminal-api";

const TERMINAL_STATUS_POLL_INTERVAL_MS = 10_000;

export function TerminalSettings() {
  const { t } = useTranslation();
  const [terminals, setTerminals] = useState<CompanyTerminalSummary[]>([]);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [binding, setBinding] = useState(false);
  const [rotatingTerminalId, setRotatingTerminalId] = useState<string | null>(null);
  const [revokingTerminalId, setRevokingTerminalId] = useState<string | null>(null);
  const [confirmTerminal, setConfirmTerminal] = useState<CompanyTerminalSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [bound, setBound] = useState(false);
  const listRequestInFlight = useRef(false);
  const disabled = binding || rotatingTerminalId !== null || revokingTerminalId !== null;
  const refresh = useCallback(async (silent = false) => {
    if (listRequestInFlight.current) return;
    listRequestInFlight.current = true;
    if (!silent) setLoading(true);
    try { const result = await listTerminals(); setTerminals(result.items); setError(null); }
    catch (listError) { setError(listError); }
    finally { listRequestInFlight.current = false; if (!silent) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => void refresh(true), TERMINAL_STATUS_POLL_INTERVAL_MS); return () => clearInterval(timer); }, [refresh]);
  const normalizedCode = normalizePairingCode(code);
  const validCode = /^[A-Z0-9]{6}$/u.test(normalizedCode);
  async function bind() { if (!validCode || disabled) return; setBinding(true); setError(null); setBound(false); try { await claimTerminal({ code: normalizedCode, ...(label.trim() ? { label: label.trim() } : {}) }); setCode(""); setLabel(""); setBound(true); await refresh(true); } catch (bindError) { setError(bindError); } finally { setBinding(false); } }
  async function confirmRevoke() { if (!confirmTerminal || disabled) return; const terminalId = confirmTerminal.terminal_id; setRevokingTerminalId(terminalId); setError(null); setBound(false); try { await revokeTerminal(terminalId); setTerminals((current) => current.filter((terminal) => terminal.terminal_id !== terminalId)); setConfirmTerminal(null); await refresh(true); } catch (revokeError) { setError(revokeError); } finally { setRevokingTerminalId(null); } }
  async function rotate(terminalId: string) { if (disabled) return; setRotatingTerminalId(terminalId); setError(null); setBound(false); try { await rotateTerminal(terminalId); await refresh(true); } catch (rotateError) { setError(rotateError); } finally { setRotatingTerminalId(null); } }
  return <div style={{ background: "var(--ant-color-bg-layout)", display: "flex", flex: 1, minHeight: 0, overflow: "auto" }}><div style={{ display: "flex", flex: 1, flexDirection: "column", gap: 24, margin: "0 auto", maxWidth: 920, padding: "24px 32px", width: "100%" }}>
    <header style={{ alignItems: "center", display: "flex", gap: 12, justifyContent: "space-between" }}><h1 style={{ fontSize: 22, margin: 0 }}>{t("terminal.title")}</h1><Button disabled={loading || disabled} icon={<RefreshCw size={15} />} loading={loading} onClick={() => void refresh()}>{t("common.refresh")}</Button></header>
    <Block gap={16} padding={18} variant="outlined"><h2 style={heading}>{t("terminal.bind")}</h2><Flexbox align="end" gap={12} horizontal wrap="wrap"><TerminalField id="terminal-pairing-code" label={t("terminal.pairingCode")} value={code} placeholder="A1B2C3" disabled={disabled} maxLength={6} autoCapitalize="characters" mono onChange={(value) => setCode(normalizePairingCode(value))} onSubmit={() => void bind()} /><TerminalField id="terminal-label" label={t("terminal.name")} value={label} placeholder={t("terminal.namePlaceholder")} disabled={disabled} maxLength={128} onChange={setLabel} onSubmit={() => void bind()} /><Button disabled={!validCode || disabled} icon={<KeyRound size={15} />} loading={binding} onClick={() => void bind()} type="primary">{binding ? t("terminal.binding") : t("terminal.bind")}</Button></Flexbox></Block>
    {error ? <Alert message={terminalErrorMessage(error, t)} showIcon type="error" /> : null}{bound ? <Alert message={t("terminal.bound")} showIcon type="success" /> : null}
    {loading && terminals.length === 0 ? <Skeleton active paragraph={{ rows: 3 }} title={false} /> : terminals.length === 0 ? <Text type="secondary">{t("terminal.none")}</Text> : <Flexbox gap={12}>{terminals.map((terminal) => <TerminalRow disabled={disabled} key={terminal.terminal_id} onRotate={() => void rotate(terminal.terminal_id)} onUnbind={() => setConfirmTerminal(terminal)} revoking={revokingTerminalId === terminal.terminal_id} rotating={rotatingTerminalId === terminal.terminal_id} terminal={terminal} />)}</Flexbox>}
  </div><Modal cancelText={t("common.cancel")} centered confirmLoading={revokingTerminalId !== null} okButtonProps={{ danger: true }} okText={revokingTerminalId ? t("terminal.unbinding") : t("terminal.unbind")} onCancel={() => { if (revokingTerminalId === null) setConfirmTerminal(null); }} onOk={() => void confirmRevoke()} open={confirmTerminal !== null} title={t("terminal.unbindTitle")}><p>{t("terminal.unbindDetail")}</p></Modal></div>;
}

const heading = { fontSize: 17, margin: 0 };
function TerminalField({ id, label, value, placeholder, disabled, maxLength, autoCapitalize, mono = false, onChange, onSubmit }: { id: string; label: string; value: string; placeholder: string; disabled: boolean; maxLength: number; autoCapitalize?: "characters"; mono?: boolean; onChange: (value: string) => void; onSubmit: () => void }) { return <label htmlFor={id} style={{ display: "flex", flex: "1 1 200px", flexDirection: "column", fontSize: 13, fontWeight: 600, gap: 6 }}><span>{label}</span><Input autoCapitalize={autoCapitalize} disabled={disabled} id={id} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSubmit(); }} placeholder={placeholder} style={mono ? { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } : undefined} value={value} /></label>; }
function TerminalRow({ terminal, rotating, revoking, disabled, onRotate, onUnbind }: { terminal: CompanyTerminalSummary; rotating: boolean; revoking: boolean; disabled: boolean; onRotate: () => void; onUnbind: () => void }) { const { t } = useTranslation(); const online = terminal.connection_status === "online"; return <Block as="article" align="center" gap={14} horizontal padding={18} variant="outlined" wrap="wrap"><div style={{ alignItems: "center", background: online ? "var(--ant-color-success-bg)" : "var(--ant-color-fill-secondary)", borderRadius: 10, display: "flex", height: 44, justifyContent: "center", width: 44 }}>{online ? <Wifi color="var(--ant-color-success)" size={20} /> : <WifiOff color="var(--ant-color-text-secondary)" size={20} />}</div><div style={{ flex: "1 1 180px" }}><Text strong>{terminal.label}</Text><Text color={connectionStatusColor(terminal.connection_status)} strong>{connectionStatusLabel(terminal.connection_status, t)}</Text></div><Button disabled={disabled} icon={<RefreshCw size={15} />} loading={rotating} onClick={onRotate}>{rotating ? t("terminal.rotating") : t("terminal.rotate")}</Button><Button danger disabled={disabled} icon={<ShieldOff size={15} />} loading={revoking} onClick={onUnbind}>{revoking ? t("terminal.unbinding") : t("terminal.unbind")}</Button></Block>; }
function normalizePairingCode(value: string): string { return value.replace(/[^a-z0-9]/giu, "").toUpperCase().slice(0, 6); }
function connectionStatusLabel(status: CompanyTerminalSummary["connection_status"], t: (key: string) => string): string { if (status === "online") return t("terminal.online"); if (status === "offline") return t("terminal.offline"); return t("terminal.unknown"); }
function connectionStatusColor(status: CompanyTerminalSummary["connection_status"]): string { if (status === "online") return "var(--ant-color-success)"; if (status === "offline") return "var(--ant-color-text-secondary)"; return "var(--ant-color-warning)"; }
function terminalErrorMessage(error: unknown, t: (key: string) => string): string { if (error instanceof TerminalApiError) { switch (error.code) { case "EMBODIMENT_PAIRING_INVALID": return t("terminal.pairingCodeInvalid"); case "EMBODIMENT_PAIRING_NOT_FOUND": return t("terminal.pairingCodeExpired"); case "EMBODIMENT_PAIRING_DELIVERY_FAILED": return t("terminal.pairingDeliveryFailed"); case "EMBODIMENT_TERMINAL_RUNTIME_UNAVAILABLE": return t("terminal.unbindFailed"); case "EMBODIMENT_TERMINAL_ROTATION_DELIVERY_FAILED": return t("terminal.rotateFailed"); default: return t("terminal.unavailable"); } } return t("terminal.unavailable"); }
