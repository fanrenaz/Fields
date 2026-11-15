ALTER TABLE "companies"
  ADD COLUMN "desktop_browser_enabled" boolean DEFAULT true NOT NULL,
  ADD COLUMN "desktop_browser_updated_at_ms" bigint;
