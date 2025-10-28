/**
 * A bidirectional string formatter that maintains mappings between original and formatted strings.
 * This class applies a formatting function to strings while caching the results to enable
 * efficient reverse lookups from formatted strings back to their original values.
 */
export class StringFormatter {
  private readonly originalToFormattedMap: Record<string, string> = {};
  private readonly formattedToOriginalMap: Record<string, string> = {};

  /** Creates a new StringFormatter instance. */
  constructor(private readonly formatter: (str: string) => string) {}

  /** Formats a string using the provided formatter function. */
  format(str: string): string {
    if (!str) return str;
    if (this.originalToFormattedMap[str]) return this.originalToFormattedMap[str];
    const original = str;
    const formatted = this.formatter(str);
    this.originalToFormattedMap[original] = formatted;
    this.formattedToOriginalMap[formatted] = original;
    return formatted;
  }

  /** Reverses a formatted string back to its original value. */
  reverse(str: string): string | null {
    return this.formattedToOriginalMap[str] ?? null;
  }
}

/** Create a string formatter which can convert tool names to an agent compliant format */
export const createAgentToolNameStringFormatter = () => new StringFormatter((str) => str.replaceAll('.', '_'));
