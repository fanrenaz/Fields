import { inlineSemanticPlainText } from "../../shared/ui/semantic-text/model";

export function searchResultPreviewText(value: string): string {
  return inlineSemanticPlainText(value);
}
