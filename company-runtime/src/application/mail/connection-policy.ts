import type {
  MailConnectionConfiguration,
  MailServerEndpoint,
} from "@fields/contracts/public/mail";
import { isIP, type LookupFunction } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

export const MAIL_CONNECTION_SSRF_BLOCKED = "MAIL_CONNECTION_SSRF_BLOCKED";
export const MAIL_CONNECTION_CONFIGURATION_INVALID = "MAIL_CONNECTION_CONFIGURATION_INVALID";

export type ResolvedMailConnection = {
  configuration: MailConnectionConfiguration;
  imap: ResolvedMailEndpoint;
  smtp: ResolvedMailEndpoint;
};

export type ResolvedMailEndpoint = MailServerEndpoint & {
  addresses: readonly ResolvedAddress[];
};
export type ResolvedAddress = { address: string; family: 4 | 6 };

const PRESET_ENDPOINTS: Record<
  Exclude<MailConnectionConfiguration["preset"], "custom">,
  { imap: MailServerEndpoint; smtp: MailServerEndpoint }
> = {
  google: {
    imap: { host: "imap.gmail.com", port: 993, tls_mode: "implicit_tls" },
    smtp: { host: "smtp.gmail.com", port: 465, tls_mode: "implicit_tls" },
  },
  microsoft: {
    imap: { host: "outlook.office365.com", port: 993, tls_mode: "implicit_tls" },
    smtp: { host: "smtp.office365.com", port: 587, tls_mode: "starttls" },
  },
  aliyun: {
    imap: { host: "imap.aliyun.com", port: 993, tls_mode: "implicit_tls" },
    smtp: { host: "smtp.aliyun.com", port: 465, tls_mode: "implicit_tls" },
  },
  tencent: {
    imap: { host: "imap.exmail.qq.com", port: 993, tls_mode: "implicit_tls" },
    smtp: { host: "smtp.exmail.qq.com", port: 465, tls_mode: "implicit_tls" },
  },
  netease: {
    imap: { host: "imap.163.com", port: 993, tls_mode: "implicit_tls" },
    smtp: { host: "smtp.163.com", port: 465, tls_mode: "implicit_tls" },
  },
  qq: {
    imap: { host: "imap.qq.com", port: 993, tls_mode: "implicit_tls" },
    smtp: { host: "smtp.qq.com", port: 465, tls_mode: "implicit_tls" },
  },
};

export class MailConnectionPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MailConnectionPolicyError";
  }
}

export async function resolveMailConnection(
  configuration: MailConnectionConfiguration,
  lookup: typeof dnsLookup = dnsLookup,
): Promise<ResolvedMailConnection> {
  const endpoints = configuration.preset === "custom"
    ? {
      imap: configuration.imap!,
      smtp: configuration.smtp!,
    }
    : PRESET_ENDPOINTS[configuration.preset];
  return {
    configuration,
    imap: await resolvePublicEndpoint(endpoints.imap, lookup),
    smtp: await resolvePublicEndpoint(endpoints.smtp, lookup),
  };
}

export async function resolvePublicEndpoint(
  endpoint: MailServerEndpoint,
  lookup: typeof dnsLookup = dnsLookup,
): Promise<ResolvedMailEndpoint> {
  const host = normalizedHostname(endpoint.host);
  if (isIP(host) !== 0) throw new MailConnectionPolicyError(MAIL_CONNECTION_SSRF_BLOCKED);
  if (
    host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
  ) {
    throw new MailConnectionPolicyError(MAIL_CONNECTION_SSRF_BLOCKED);
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true }) as ResolvedAddress[];
  } catch {
    throw new MailConnectionPolicyError(MAIL_CONNECTION_CONFIGURATION_INVALID);
  }
  if (addresses.length === 0 || addresses.some((entry) => isForbiddenAddress(entry.address))) {
    throw new MailConnectionPolicyError(MAIL_CONNECTION_SSRF_BLOCKED);
  }
  return { ...endpoint, host, addresses };
}

export function pinnedLookup(endpoint: ResolvedMailEndpoint): LookupFunction {
  return ((hostname, options, callback) => {
    const normalized = normalizedHostname(hostname);
    if (normalized !== endpoint.host) {
      callback(Object.assign(new Error(MAIL_CONNECTION_SSRF_BLOCKED), {
        code: MAIL_CONNECTION_SSRF_BLOCKED,
      }), "", 0);
      return;
    }
    const optionsObject = typeof options === "object" ? options : {};
    const family = typeof options === "number" ? options : optionsObject.family;
    const candidates = endpoint.addresses.filter((entry) => (
      !family || family === 0 || entry.family === family
    ));
    if (candidates.length === 0) {
      callback(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), "", 0);
      return;
    }
    if (optionsObject.all) {
      callback(null, candidates);
      return;
    }
    const selected = candidates[0]!;
    callback(null, selected.address, selected.family);
  }) as LookupFunction;
}

export function isForbiddenAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  if (isIP(normalized) === 4) return forbiddenIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  const bytes = parseIpv6(normalized);
  if (!bytes) return true;
  if (bytes.every((value) => value === 0)) return true;
  if (bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1) return true;
  if ((bytes[0]! & 0xfe) === 0xfc) return true;
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true;
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0) return true;
  if (bytes[0] === 0xff) return true;
  const firstTenZero = bytes.slice(0, 10).every((value) => value === 0);
  const firstTwelveZero = bytes.slice(0, 12).every((value) => value === 0);
  const mapped = firstTenZero && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped) {
    return forbiddenIpv4(bytes.slice(12).join("."));
  }
  if (firstTwelveZero) return true;
  return (
    inCidr(bytes, [0x00, 0x64, 0xff, 0x9b], 96)
    || inCidr(bytes, [0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48)
    || inCidr(bytes, [0x01, 0x00], 64)
    || inCidr(bytes, [0x20, 0x01], 23)
    || inCidr(bytes, [0x20, 0x01, 0x0d, 0xb8], 32)
    || inCidr(bytes, [0x20, 0x02], 16)
    || inCidr(bytes, [0x3f, 0xff], 20)
    || inCidr(bytes, [0x5f, 0x00], 16)
  );
}

function forbiddenIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => value < 0 || value > 255)) return true;
  const [a, b, c] = octets as [number, number, number, number];
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
  );
}

function inCidr(address: readonly number[], prefix: readonly number[], bits: number): boolean {
  const wholeBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;
  for (let index = 0; index < wholeBytes; index += 1) {
    if (address[index] !== (prefix[index] ?? 0)) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return ((address[wholeBytes] ?? 0) & mask) === ((prefix[wholeBytes] ?? 0) & mask);
}

function normalizedHostname(value: string): string {
  const host = value.trim().toLowerCase().replace(/\.$/u, "");
  if (
    host.length === 0
    || host.length > 253
    || host.includes("/")
    || host.includes("\\")
    || host.includes("@")
    || host.includes(":")
    || !/^[a-z0-9.-]+$/u.test(host)
    || host.split(".").some((label) => (
      label.length === 0
      || label.length > 63
      || label.startsWith("-")
      || label.endsWith("-")
    ))
  ) {
    throw new MailConnectionPolicyError(MAIL_CONNECTION_CONFIGURATION_INVALID);
  }
  return host;
}

function parseIpv6(address: string): number[] | null {
  const zoneIndex = address.indexOf("%");
  const source = zoneIndex >= 0 ? address.slice(0, zoneIndex) : address;
  const pieces = source.split("::");
  if (pieces.length > 2) return null;
  const left = ipv6Side(pieces[0] ?? "");
  const right = ipv6Side(pieces[1] ?? "");
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if ((pieces.length === 1 && missing !== 0) || (pieces.length === 2 && missing < 1)) {
    return null;
  }
  const words = [...left, ...Array.from({ length: missing }, () => 0), ...right];
  if (words.length !== 8) return null;
  return words.flatMap((word) => [word >> 8, word & 0xff]);
}

function ipv6Side(value: string): number[] | null {
  if (!value) return [];
  const labels = value.split(":");
  const words: number[] = [];
  for (const label of labels) {
    if (label.includes(".")) {
      const octets = label.split(".").map(Number);
      if (
        octets.length !== 4
        || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
      ) {
        return null;
      }
      words.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
      continue;
    }
    if (!/^[\da-f]{1,4}$/u.test(label)) return null;
    words.push(Number.parseInt(label, 16));
  }
  return words;
}
