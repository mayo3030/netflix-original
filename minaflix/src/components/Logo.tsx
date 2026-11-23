import { useLanguage } from '../i18n/LanguageProvider';
import { Mark } from './Icons';

export function Logo() {
  const { language } = useLanguage();
  return (
    <span className="logo">
      <Mark className="logo-mark" />
      <span className="word" lang={language === 'ar' ? 'ar' : 'en'}>
        {language === 'ar' ? 'مينافليكس' : <>Mina<span className="word-accent">flix</span></>}
      </span>
    </span>
  );
}
