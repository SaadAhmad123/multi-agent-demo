export const tryParseJson = (str: string): object | null => {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};
