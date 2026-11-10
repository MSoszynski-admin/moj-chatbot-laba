import {
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  generateText,
  type LanguageModel,
} from "ai";
import {
  ANALYSIS_SYSTEM_PROMPT,
  AnalysisSchema,
  interpretModelOutput,
  type AnalysisOutcome,
} from "./analysis";
import { describeProviderError } from "./provider-errors";

export type AnalyzeResult =
  | AnalysisOutcome
  | { ok: false; reason: "provider"; message: string };

/**
 * Wywołuje model w trybie structured output, a potem i tak sprawdza wynik
 * na serwerze. Sam tryb JSON u dostawcy nie wystarcza: model może odmówić,
 * odpowiedź może zostać ucięta, a dostawca może zignorować schemat.
 */
export async function analyzeMessage(
  model: LanguageModel,
  message: string,
): Promise<AnalyzeResult> {
  try {
    const result = await generateText({
      model,
      system: ANALYSIS_SYSTEM_PROMPT,
      prompt: message,
      output: Output.object({
        schema: AnalysisSchema,
        name: "analiza_wiadomosci",
        description: "Analiza wiadomości klienta Studio Nova",
      }),
      maxOutputTokens: 1000,
      maxRetries: 1,
    });

    return interpretModelOutput(result.text, result.finishReason);
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      return interpretModelOutput(error.text, error.finishReason);
    }
    if (NoOutputGeneratedError.isInstance(error)) {
      return interpretModelOutput(undefined, undefined);
    }
    return { ok: false, reason: "provider", message: describeProviderError(error) };
  }
}
