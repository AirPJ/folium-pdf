// Translations. English text is the key; other languages map it to their
// own text. Missing entries fall back to English.

import { getState, type Lang } from "./store";
import { fr } from "./locales/fr";

const dictionaries: Record<Lang, Record<string, string>> = { en: {}, fr };

export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
];

export function lang(): Lang {
  return getState().lang;
}

/** Translates `text`, filling `{name}` placeholders from `vars`. */
export function t(text: string, vars?: Record<string, string | number>): string {
  let out = dictionaries[lang()][text] ?? text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** Picks the singular or plural form, then translates it. */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  // French uses the singular for 0 and 1; English only for 1.
  const singular = lang() === "fr" ? n < 2 : n === 1;
  return t(singular ? one : many, { n, ...vars });
}

/** Number formatting that follows the language (1 234,5 in French). */
export function num(n: number, digits = 0): string {
  return n.toLocaleString(lang() === "fr" ? "fr-FR" : "en-GB", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function formatBytes(n: number): string {
  const fr = lang() === "fr";
  if (n < 1024) return `${n} ${fr ? "o" : "B"}`;
  if (n < 1024 * 1024) return `${num(Math.round(n / 1024))} ${fr ? "Ko" : "KB"}`;
  return `${num(n / 1024 / 1024, 1)} ${fr ? "Mo" : "MB"}`;
}
