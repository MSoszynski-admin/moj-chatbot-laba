// Kontrola backendu po analizie (lekcja 2, W3).
// Model może dać się przekonać treści wiadomości. Dlatego serwer sam
// sprawdza wynik i w razie wątpliwości wymusza needs_review=true.
// To nie zastępuje instrukcji, tylko ją uzupełnia: decyzja „bez sprawdzenia”
// nigdy nie zależy wyłącznie od modelu.

import type { Analysis } from "./analysis";

/** Kwoty, które firma faktycznie podała (konsultacja: 150 zł brutto). */
export const ALLOWED_PRICES_PLN = [150];

// Typowe ślady prób wydania poleceń asystentowi w treści wiadomości.
const INJECTION_PATTERNS: RegExp[] = [
  /zignoruj|ignoruj|pomiń\s+(zasady|instrukcj)/i,
  /ignore\s+(all|previous|the)/i,
  /dla\s+asystenta|do\s+asystenta|instrukcj[aęi]\s+systemow/i,
  /system\s*prompt|prompt\s*systemow/i,
  /od\s+teraz/i,
  /needs_review|send_now|priority\s*=|category\s*=/i,
  /jesteś\s+teraz|udawaj|zmień\s+(zasady|rolę|cenę)/i,
];

export function findInjectionMarkers(message: string) {
  return INJECTION_PATTERNS.filter((pattern) => pattern.test(message)).map(
    (pattern) => pattern.source,
  );
}

/** Zwraca kwoty w złotych znalezione w tekście, np. "1 zł", "150,00 zł", "20 PLN". */
export function findPrices(text: string) {
  const matches = text.matchAll(/(\d+(?:[.,]\d{1,2})?)\s*(?:zł|zl|pln)(?!\p{L})/giu);
  return [...matches].map((m) => Number(m[1].replace(",", ".")));
}

export type GuardWarning = { code: string; message: string };

export function applyGuards(
  message: string,
  analysis: Analysis,
): { analysis: Analysis; warnings: GuardWarning[] } {
  const warnings: GuardWarning[] = [];

  if (findInjectionMarkers(message).length > 0) {
    warnings.push({
      code: "instruction_in_message",
      message:
        "Wiadomość zawiera polecenia dla asystenta (np. zmianę zasad, ceny lub pól wyniku). Potraktowano je jako treść, nie jako instrukcję. Sprawdź sprawę przed odpowiedzią.",
    });
  }

  const unknownPrices = findPrices(analysis.draft).filter(
    (price) => !ALLOWED_PRICES_PLN.includes(price),
  );
  if (unknownPrices.length > 0) {
    warnings.push({
      code: "unverified_price",
      message: `Szkic zawiera kwotę spoza informacji firmy (${unknownPrices
        .map((p) => `${p} zł`)
        .join(", ")}). Nie wysyłaj go bez sprawdzenia.`,
    });
  }

  return {
    analysis:
      warnings.length > 0 ? { ...analysis, needs_review: true } : analysis,
    warnings,
  };
}
