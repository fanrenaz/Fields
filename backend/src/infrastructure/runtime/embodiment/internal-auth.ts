import { readFile } from "node:fs/promises";

export async function embodimentInternalControlTokenMatches(authorization: string | string[] | undefined, tokenFile: string): Promise<boolean> {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length);
  if (!token || token.length > 4096 || /[\r\n]/u.test(token) || !tokenFile) return false;
  try { return constantTimeEqual(token, (await readFile(tokenFile, "utf8")).trim()); } catch { return false; }
}
function constantTimeEqual(left: string, right: string): boolean { if (left.length !== right.length) return false; let result = 0; for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index); return result === 0; }
