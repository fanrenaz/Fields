export function openExternalUrl(value: string): void {
  const target = new URL(value, window.location.href);
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new Error(`Unsupported external URL protocol: ${target.protocol}`);
  }
  window.open(target.toString(), "_blank", "noopener,noreferrer");
}
