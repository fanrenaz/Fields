const PHONE_USER_AGENT = /(?:Android.+Mobile|iPhone|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile)/iu;

export function isPhoneClient(input: {
  desktopBridge: boolean;
  mobileHint?: boolean;
  userAgent: string;
}): boolean {
  return !input.desktopBridge && (input.mobileHint ?? PHONE_USER_AGENT.test(input.userAgent));
}

export function currentPhoneClient(): boolean {
  if (typeof window === "undefined") return false;
  return isPhoneClient({
    desktopBridge: Boolean(window.fieldsDesktop),
    mobileHint: (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile,
    userAgent: navigator.userAgent,
  });
}
