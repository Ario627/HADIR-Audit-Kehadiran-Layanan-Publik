import { useEffect, useState } from 'react';

function readOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(readOnline);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}