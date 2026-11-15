import type {
  CompanyProxyProtocol,
  CompanyProxyStatus,
} from "@fields/contracts/public/executor";
import { Alert, Block, Flexbox, Text } from "@lobehub/ui";
import { Button, Input } from "@lobehub/ui/base-ui";
import { Network } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { authServiceErrorMessage } from "../../data/auth/auth-machine-services";
import { backendTrpc } from "../../data/boundary/backend-trpc";

export function CompanyProxySettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CompanyProxyStatus | null>(null);
  const [protocol, setProtocol] = useState<CompanyProxyProtocol>("http");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void backendTrpc.account.proxy.get.query().then((next) => {
      setStatus(next);
      if (next.protocol) setProtocol(next.protocol);
      setHost(next.endpoint_host ?? "");
      setPort(next.endpoint_port ? String(next.endpoint_port) : "");
      setAuthenticated(next.authentication === "username_password");
    }).catch(setError);
  }, []);

  async function save() {
    const endpointPort = Number(port);
    if (!status || !host.trim() || !Number.isInteger(endpointPort) || endpointPort < 1 || endpointPort > 65_535) return;
    setBusy(true);
    setError(null);
    try {
      const next = await backendTrpc.account.proxy.set.mutate({
        protocol,
        endpoint_host: host.trim(),
        endpoint_port: endpointPort,
        credentials: authenticated ? { username, password } : null,
        expected_revision: status.revision,
      });
      setStatus(next);
      setPassword("");
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!status) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await backendTrpc.account.proxy.disable.mutate({
        expected_revision: status.revision,
      }));
      setPassword("");
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  const invalid = !status || !host.trim() || !Number.isInteger(Number(port))
    || Number(port) < 1 || Number(port) > 65_535
    || (authenticated && (!username || !password));

  return (
    <Block gap={16} padding={16} variant="outlined">
      <Flexbox align="center" gap={10} horizontal>
        <Network size={20} />
        <div>
          <Text strong>{t("executor.companyProxyTitle")}</Text>
          <Text type="secondary">{t("executor.companyProxyDescription")}</Text>
        </div>
      </Flexbox>
      <Flexbox gap={8} horizontal wrap="wrap">
        {(["http", "https", "socks5"] as const).map((value) => (
          <Button
            key={value}
            disabled={busy}
            onClick={() => setProtocol(value)}
            type={protocol === value ? "primary" : "default"}
          >
            {value === "socks5" ? "SOCKS5" : value.toUpperCase()}
          </Button>
        ))}
      </Flexbox>
      <Flexbox gap={8} horizontal>
        <Input
          disabled={busy}
          onChange={(event) => setHost(event.target.value)}
          placeholder={t("executor.proxyHost")}
          value={host}
        />
        <Input
          disabled={busy}
          inputMode="numeric"
          onChange={(event) => setPort(event.target.value)}
          placeholder={t("executor.proxyPort")}
          style={{ maxWidth: 160 }}
          value={port}
        />
      </Flexbox>
      <Flexbox gap={8} horizontal>
        <Button
          disabled={busy}
          onClick={() => setAuthenticated(false)}
          type={!authenticated ? "primary" : "default"}
        >
          {t("executor.proxyNoAuthentication")}
        </Button>
        <Button
          disabled={busy}
          onClick={() => setAuthenticated(true)}
          type={authenticated ? "primary" : "default"}
        >
          {t("executor.proxyUsernamePassword")}
        </Button>
      </Flexbox>
      {authenticated ? (
        <Flexbox gap={8} horizontal>
          <Input
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={t("executor.proxyUsername")}
            value={username}
          />
          <Input
            autoComplete="new-password"
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={status?.authentication === "username_password"
              ? t("executor.proxyPasswordReplace")
              : t("executor.proxyPassword")}
            type="password"
            value={password}
          />
        </Flexbox>
      ) : null}
      {error ? (
        <Alert
          message={authServiceErrorMessage(error, t("executor.proxySaveFailed"))}
          showIcon
          type="error"
        />
      ) : null}
      <Text type="secondary">
        {status?.enabled ? t("executor.proxyEnabled") : t("executor.proxyDisabled")}
      </Text>
      <Flexbox gap={8} horizontal>
        <Button disabled={busy || invalid} onClick={() => void save()} type="primary">
          {busy ? t("executor.proxyTesting") : t("executor.proxySaveAndTest")}
        </Button>
        {status?.enabled ? (
          <Button disabled={busy} onClick={() => void disable()}>
            {t("executor.proxyDisable")}
          </Button>
        ) : null}
      </Flexbox>
    </Block>
  );
}
