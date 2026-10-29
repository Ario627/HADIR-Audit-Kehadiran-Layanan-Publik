import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_ACCURACY_M, readFix, type GeoFix } from './geo';

export type GeoStatus =
  | 'idle'
  | 'locating'
  | 'ready'
  | 'denied'
  | 'unsupported'
  | 'timeout'
  | 'error';

export interface GeoState {
  status: GeoStatus;
  fix: GeoFix | null;
  message: string | null;
}

export interface GeoController extends GeoState {
  request: () => void;
  stop: () => void;
  reset: () => void;
}

const STALL_MS = 60_000;

const OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 5_000,
  timeout: 12_000,
};

function errorState(code: number): GeoState {
  if (code === 1) {
    return {
      status: 'denied',
      fix: null,
      message: 'Izin lokasi ditolak. Kamu tetap bisa memilih halte secara manual.',
    };
  }
  if (code === 3) {
    return {
      status: 'timeout',
      fix: null,
      message: 'Perangkat belum menemukan titik lokasi. Coba lagi di area terbuka.',
    };
  }
  return {
    status: 'error',
    fix: null,
    message: 'Lokasi gagal dibaca. Pilih halte secara manual bila tetap gagal.',
  };
}

export function useGeolocation(): GeoController {
  const [state, setState] = useState<GeoState>({ status: 'idle', fix: null, message: null });
  const watchRef = useRef<number | null>(null);
  const stallRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWatch = useCallback((): void => {
    if (stallRef.current !== null) {
      clearTimeout(stallRef.current);
      stallRef.current = null;
    }
    if (watchRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchRef.current);
    }
    watchRef.current = null;
  }, []);

  const stop = useCallback((): void => {
    clearWatch();
    setState((current) =>
      current.status === 'locating'
        ? { status: current.fix === null ? 'idle' : 'ready', fix: current.fix, message: null }
        : current,
    );
  }, [clearWatch]);

  const reset = useCallback((): void => {
    clearWatch();
    setState({ status: 'idle', fix: null, message: null });
  }, [clearWatch]);

  const request = useCallback((): void => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({
        status: 'unsupported',
        fix: null,
        message: 'Peramban ini tidak mendukung pembacaan lokasi. Pilih halte secara manual.',
      });
      return;
    }
    clearWatch();
    setState({ status: 'locating', fix: null, message: null });

    watchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const fix = readFix(position);
        if (fix === null) {
          return;
        }
        setState((current) => {
          const best =
            current.fix === null || fix.accuracyM <= current.fix.accuracyM ? fix : current.fix;
          return { status: 'ready', fix: best, message: null };
        });
        if (fix.accuracyM <= MAX_ACCURACY_M) {
          clearWatch();
        }
      },
      (error) => {
        clearWatch();
        setState(errorState(error.code));
      },
      OPTIONS,
    );

    stallRef.current = setTimeout(() => {
      clearWatch();
      setState((current) =>
        current.status === 'ready'
          ? current
          : {
              status: 'timeout',
              fix: current.fix,
              message: 'Perangkat belum mengirim titik lokasi yang cukup akurat.',
            },
      );
    }, STALL_MS);
  }, [clearWatch]);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        clearWatch();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearWatch();
    };
  }, [clearWatch]);

  return { ...state, request, stop, reset };
}