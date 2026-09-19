import { afterEach, describe, expect, it } from "vitest";
import { applyDisplayLanguage, createAppI18n } from "./i18n";
import {
  messageKeys,
  resources,
  supportedDisplayLanguages,
} from "./i18n-resources";

describe("message catalogs", () => {
  afterEach(() => {
    applyDisplayLanguage("en");
  });

  it("keeps identical key coverage for every supported locale", () => {
    const englishKeys = messageKeys(resources.en).sort();

    for (const language of supportedDisplayLanguages) {
      expect(messageKeys(resources[language]).sort()).toEqual(englishKeys);
    }
  });

  it("falls back to English without exposing a missing key", () => {
    const fallbackI18n = createAppI18n();
    fallbackI18n.removeResourceBundle("ja", "translation");
    fallbackI18n.addResourceBundle(
      "ja",
      "translation",
      { common: { bootstrap: { loading: "読み込み中" } } },
      true,
      true,
    );
    void fallbackI18n.changeLanguage("ja");

    expect(fallbackI18n.t("common.bootstrap.errorTitle")).toBe(
      "Unable to load your workspace.",
    );
    expect(fallbackI18n.t("common.bootstrap.errorTitle")).not.toBe(
      "common.bootstrap.errorTitle",
    );
  });
});
