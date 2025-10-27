/**
 * A bidirectional string formatter that maintains mappings between original and formatted strings.
 * This class applies a formatting function to strings while caching the results to enable
 * efficient reverse lookups from formatted strings back to their original values.
 *
 * **Why this is needed:**
 *
 * This class is useful when you need to transform strings for display, storage, or processing
 * while preserving the ability to retrieve the original values.
 *
 * The bidirectional mapping and caching ensure that formatting operations are efficient and
 * that you can always recover the original value without needing to store it separately or
 * implement complex reverse transformation logic.
 */
export class StringFormatter {
  private readonly originalToFormattedMap: Record<string, string> = {};
  private readonly formattedToOriginalMap: Record<string, string> = {};

  /**
   * Creates a new StringFormatter instance.
   *
   * @param formatter - A function that transforms a string into its formatted version.
   *                    This function will be called once per unique input string.
   *                    The function should be deterministic (same input always produces same output)
   *                    for the reverse mapping to work correctly.
   */
  constructor(private readonly formatter: (str: string) => string) {}

  /**
   * Formats a string using the provided formatter function.
   * Results are cached, so subsequent calls with the same string return the cached value.
   * Both the forward and reverse mappings are stored for efficient bidirectional lookups.
   */
  format(str: string): string {
    if (!str) return str;
    if (this.originalToFormattedMap[str]) return this.originalToFormattedMap[str];
    const original = str;
    const formatted = this.formatter(str);
    this.originalToFormattedMap[original] = formatted;
    this.formattedToOriginalMap[formatted] = original;
    return formatted;
  }

  /**
   * Reverses a formatted string back to its original value.
   * This is particularly useful when you have a formatted value (e.g., from a URL, database, or UI)
   * and need to retrieve the original value without storing it separately or implementing
   * complex reverse transformation logic.
   */
  reverse(str: string): string | null {
    return this.formattedToOriginalMap[str] ?? null;
  }
}

/**
 * Create a string formatter which can convert tool names to an agent compliant format
 */
export const createAgentToolNameStringFormatter = () => new StringFormatter((str) => str.replaceAll('.', '_'));
