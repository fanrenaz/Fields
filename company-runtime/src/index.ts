export const CLIENT_NAME = "fields-company-runtime";
export const CLIENT_VERSION = "0.1.3";

export type ClientStatus = {
  ok: true;
  name: typeof CLIENT_NAME;
  version: typeof CLIENT_VERSION;
};

export function clientStatus(): ClientStatus {
  return {
    ok: true,
    name: CLIENT_NAME,
    version: CLIENT_VERSION,
  };
}
