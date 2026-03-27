import { useEffect, useState } from 'react';
import { readUserTimeZoneState, type UserTimeZoneState } from '@/lib/utils/timezone';

export function useUserTimeZone(): UserTimeZoneState {
  const [state, setState] = useState<UserTimeZoneState>(() => readUserTimeZoneState());

  useEffect(() => {
    const sync = () => setState(readUserTimeZoneState());
    window.addEventListener('storage', sync);
    window.addEventListener('tfi:settings-updated', sync as EventListener);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('tfi:settings-updated', sync as EventListener);
    };
  }, []);

  return state;
}
