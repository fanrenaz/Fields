import type { DesktopBrowserSetInput } from "@fields/contracts/public/desktop-browser";
import { sql } from "drizzle-orm";

import type { BackendDatabase } from "../../database-service.js";

type BrowserRow = {
  desktop_browser_enabled: boolean;
  desktop_browser_updated_at_ms: number | string | bigint | null;
};

export class PostgresDesktopBrowserRepository {
  constructor(
    private readonly db: BackendDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  async get(companyId: string): Promise<{ enabled: boolean; updated_at_ms: number | null }> {
    const result = await this.db.execute(sql`
      select desktop_browser_enabled, desktop_browser_updated_at_ms
      from companies where id = ${companyId} limit 2
    `);
    const rows = result.rows as BrowserRow[];
    if (rows.length !== 1) throw new Error("Company browser settings are unavailable.");
    return browserState(rows[0]!);
  }

  async set(companyId: string, input: DesktopBrowserSetInput): Promise<{ enabled: boolean; updated_at_ms: number | null }> {
    const updatedAtMs = this.now();
    const result = await this.db.execute(sql`
      update companies
      set desktop_browser_enabled = ${input.enabled},
        desktop_browser_updated_at_ms = ${updatedAtMs},
        updated_at_ms = ${updatedAtMs}
      where id = ${companyId}
      returning desktop_browser_enabled, desktop_browser_updated_at_ms
    `);
    const rows = result.rows as BrowserRow[];
    if (rows.length !== 1) throw new Error("Company browser settings are unavailable.");
    return browserState(rows[0]!);
  }
}

function browserState(row: BrowserRow): { enabled: boolean; updated_at_ms: number | null } {
  return {
    enabled: row.desktop_browser_enabled,
    updated_at_ms: row.desktop_browser_updated_at_ms === null
      ? null
      : Number(row.desktop_browser_updated_at_ms),
  };
}
