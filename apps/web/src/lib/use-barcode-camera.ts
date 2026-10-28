import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus =
  | 'idle'
  | 'starting'
  | 'scanning'
  | 'unsupported'
  | 'denied'
  | 'no_camera'
  | 'busy'
  | 'error';

export interface CameraController {
  status: CameraStatus;
  message: string | null;
  supported: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  start: () => void;
  stop: () => void;
}

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: readonly string[] }): BarcodeDetectorLike;
}

const FORMATS = ['qr_code'];
const FALLBACK_INTERVAL_MS = 220;
const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

type WindowWithDetector = { BarcodeDetector?: BarcodeDetectorCtor };

function detectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const ctor = (window as unknown as WindowWithDetector).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

function cameraAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices === 'object' &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

function failureFor(error: unknown): { status: CameraStatus; message: string } {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      status: 'denied',
      message:
        'Izin kamera ditolak. Masukkan kode halte di bawah, atau izinkan kamera di setelan situs.',
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return {
      status: 'no_camera',
      message:
        'Perangkat ini tidak punya kamera yang bisa dipakai. Masukkan kode halte secara manual.',
    };
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return {
      status: 'busy',
      message: 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.',
    };
  }
  return {
    status: 'error',
    message: 'Kamera gagal dinyalakan. Masukkan kode halte secara manual.',
  };
}

export function useBarcodeCamera(onValue: (raw: string) => void): CameraController {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const timerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const sessionRef = useRef(0);
  const handlerRef = useRef(onValue);
  handlerRef.current = onValue;

  const [status, setStatus] = useState<CameraStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const teardown = useCallback((): void => {
    sessionRef.current += 1;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const video = videoRef.current;
    if (frameRef.current !== null && typeof video?.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(frameRef.current);
    }
    frameRef.current = null;
    if (streamRef.current !== null) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (video !== null) {
      video.srcObject = null;
    }
    detectorRef.current = null;
  }, []);

  const stop = useCallback((): void => {
    teardown();
    setStatus((current) => (current === 'scanning' || current === 'starting' ? 'idle' : current));
    setMessage(null);
  }, [teardown]);

  const schedule = useCallback(
    (session: number, video: HTMLVideoElement, detector: BarcodeDetectorLike): void => {
      const detect = async (): Promise<void> => {
        if (session !== sessionRef.current) {
          return;
        }
        let found: string | null = null;
        if (video.readyState >= 2) {
          try {
            const codes = await detector.detect(video);
            const first = codes[0];
            found = first === undefined ? null : first.rawValue;
          } catch {
            found = null;
          }
        }
        if (session !== sessionRef.current) {
          return;
        }
        if (found !== null) {
          handlerRef.current(found);
          teardown();
          setStatus('idle');
          setMessage(null);
          return;
        }
        if (typeof video.requestVideoFrameCallback === 'function') {
          frameRef.current = video.requestVideoFrameCallback(() => {
            void detect();
          });
          return;
        }
        timerRef.current = window.setTimeout(() => {
          void detect();
        }, FALLBACK_INTERVAL_MS);
      };
      void detect();
    },
    [teardown],
  );

  const start = useCallback((): void => {
    const ctor = detectorCtor();
    if (ctor === null) {
      setStatus('unsupported');
      setMessage(
        'Peramban ini belum bisa membaca QR langsung. Masukkan kode halte atau tempel tautan QR.',
      );
      return;
    }
    if (!cameraAvailable()) {
      setStatus('unsupported');
      setMessage('Peramban ini tidak memberi akses kamera. Masukkan kode halte secara manual.');
      return;
    }
    teardown();
    const session = sessionRef.current;
    setStatus('starting');
    setMessage(null);

    navigator.mediaDevices
      .getUserMedia(CONSTRAINTS)
      .then((stream) => {
        if (session !== sessionRef.current) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video === null) {
          teardown();
          setStatus('error');
          setMessage('Pratinjau kamera tidak siap. Masukkan kode halte secara manual.');
          return;
        }
        video.srcObject = stream;
        detectorRef.current = new ctor({ formats: FORMATS });
        return video.play().then(() => {
          if (session !== sessionRef.current) {
            return;
          }
          setStatus('scanning');
          const detector = detectorRef.current;
          if (detector !== null) {
            schedule(session, video, detector);
          }
        });
      })
      .catch((error: unknown) => {
        if (session !== sessionRef.current) {
          return;
        }
        const failure = failureFor(error);
        teardown();
        setStatus(failure.status);
        setMessage(failure.message);
      });
  }, [schedule, teardown]);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        teardown();
        setStatus((current) => (current === 'scanning' ? 'idle' : current));
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      teardown();
    };
  }, [teardown]);

  return {
    status,
    message,
    supported: detectorCtor() !== null,
    videoRef,
    start,
    stop,
  };
}