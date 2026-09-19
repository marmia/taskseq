import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import {
  type DisplayLanguage,
  displayLanguageSchema,
} from "../shared/api-schema";
import { resources, supportedDisplayLanguages } from "./i18n-resources";

export function createAppI18n() {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    resources,
    returnEmptyString: false,
    supportedLngs: [...supportedDisplayLanguages],
  });
  return instance;
}

export const i18n = createAppI18n();

export function applyDisplayLanguage(language: DisplayLanguage) {
  const parsedLanguage = displayLanguageSchema.parse(language);
  if (i18n.language !== parsedLanguage) {
    void i18n.changeLanguage(parsedLanguage);
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = parsedLanguage;
  }
}
