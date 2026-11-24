const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const MAX_NAME_LENGTH = 60;

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character]);

/**
 * A user's name as plain text, safe for a subject line. Anyone can sign up with
 * someone else's address and any name, so a name must never carry a link: mail
 * apps turn "evil.com" into one even in plain text.
 */
export const toPlainName = (name: string): string => {
  const plain = Array.from(
    name
      .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
      .replace(/[<>/\\@]+/g, ' ')
      .replace(/:/g, ' ')
      .replace(/[.。．](?=\S)/g, '. ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  return plain.slice(0, MAX_NAME_LENGTH).join('').trim();
};

/** A user's name for use inside email HTML. */
export const toHtmlName = (name: string): string =>
  escapeHtml(toPlainName(name));
