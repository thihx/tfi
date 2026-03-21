import { useEffect, useState } from 'react';

export type UiLanguage = 'en' | 'vi';

function readUiLanguage(): UiLanguage {
  try {
    const raw = localStorage.getItem('liveMonitorConfig');
    if (!raw) return 'vi';
    const parsed = JSON.parse(raw) as { UI_LANGUAGE?: UiLanguage; NOTIFICATION_LANGUAGE?: UiLanguage };
    if (parsed.UI_LANGUAGE === 'en' || parsed.UI_LANGUAGE === 'vi') return parsed.UI_LANGUAGE;
    if (parsed.NOTIFICATION_LANGUAGE === 'en' || parsed.NOTIFICATION_LANGUAGE === 'vi') return parsed.NOTIFICATION_LANGUAGE;
  } catch {
    // ignore invalid storage
  }
  return 'vi';
}

export function useUiLanguage(): UiLanguage {
  const [language, setLanguage] = useState<UiLanguage>(() => readUiLanguage());

  useEffect(() => {
    const sync = () => setLanguage(readUiLanguage());
    window.addEventListener('storage', sync);
    window.addEventListener('tfi:settings-updated', sync as EventListener);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('tfi:settings-updated', sync as EventListener);
    };
  }, []);

  return language;
}

