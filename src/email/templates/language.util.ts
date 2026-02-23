export type SupportedEmailLanguage = 'en' | 'fr';

export const resolveSupportedEmailLanguage = (
  language: string | null | undefined,
): SupportedEmailLanguage => {
  const normalizedLanguage = String(language ?? '')
    .trim()
    .toLowerCase();
  return normalizedLanguage === 'fr' ? 'fr' : 'en';
};

export const getLocaleForLanguage = (
  language: SupportedEmailLanguage,
): string => {
  return language === 'fr' ? 'fr-FR' : 'en-US';
};
