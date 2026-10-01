/**
 * Return the four counts shown by Text Meter.
 * Characters are Unicode code points; words are non-empty, whitespace-separated runs.
 */
export function countText(value) {
  const text = String(value ?? '');
  const characters = Array.from(text);
  const hasText = text.length > 0;

  return {
    characters: characters.length,
    nonWhitespaceCharacters: characters.filter((character) => !/\s/u.test(character)).length,
    words: text.trim() ? text.trim().split(/\s+/u).length : 0,
    lines: hasText ? text.split(/\r\n|\r|\n/u).length : 0,
  };
}
