export type SupportedEmailLanguage = 'en' | 'fr' | 'es';

export const resolveSupportedEmailLanguage = (
  language: string | null | undefined,
): SupportedEmailLanguage => {
  const normalizedLanguage = String(language ?? '')
    .trim()
    .toLowerCase();
  if (normalizedLanguage === 'fr' || normalizedLanguage === 'es') {
    return normalizedLanguage;
  }
  return 'en';
};

export const getLocaleForLanguage = (
  language: SupportedEmailLanguage,
): string => {
  if (language === 'fr') return 'fr-FR';
  if (language === 'es') return 'es-ES';
  return 'en-US';
};
