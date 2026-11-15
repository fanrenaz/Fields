import assert from "node:assert/strict";
import test from "node:test";

import { i18n } from "../../../../shared/i18n/i18n";
import { translation as en } from "../../../../shared/i18n/resources/en";
import { translation as zhCN } from "../../../../shared/i18n/resources/zh-CN";
import { translation as zhTW } from "../../../../shared/i18n/resources/zh-TW";

function leafKeys(tree: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : leafKeys(value as Record<string, unknown>, path);
  }).sort();
}

test("all locale resources have the exact English key shape", () => {
  assert.deepEqual(leafKeys(zhCN), leafKeys(en));
  assert.deepEqual(leafKeys(zhTW), leafKeys(en));
});

test("resources support interpolation and plural output", async () => {
  await i18n.changeLanguage("en");
  assert.equal(i18n.t("auth.showField", { field: "password" }), "Show password");
  assert.equal(i18n.t("common.item", { count: 2 }), "2 items");
  await i18n.changeLanguage("zh-CN");
  assert.equal(i18n.t("auth.showField", { field: "密码" }), "显示密码");
  assert.equal(i18n.t("common.item", { count: 2 }), "2 项");
  await i18n.changeLanguage("zh-TW");
  await i18n.changeLanguage("en");
});
