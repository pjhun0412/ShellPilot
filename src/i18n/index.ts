import ko from './locales/ko.json';
import en from './locales/en.json';

type Locale = 'ko' | 'en';
type MessageKey = keyof typeof ko;

const resources: Record<Locale, Record<MessageKey, string>> = {
  ko,
  en,
};

const defaultLocale: Locale = 'ko';

export function t(key: MessageKey, locale: Locale = defaultLocale): string {
  return resources[locale][key] ?? resources[defaultLocale][key] ?? key;
}
