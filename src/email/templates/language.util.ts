import {
  resolveSupportedLanguage,
  type SupportedLanguage,
} from '../../utils/locale.util';

export type SupportedEmailLanguage = SupportedLanguage;

export const resolveSupportedEmailLanguage = (
  language: string | null | undefined,
): SupportedEmailLanguage => resolveSupportedLanguage(language);

export const getLocaleForLanguage = (
  language: SupportedEmailLanguage,
): string => {
  if (language === 'fr') return 'fr-FR';
  if (language === 'es') return 'es-ES';
  return 'en-US';
};
