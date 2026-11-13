import { useEffect, useRef, useState } from 'react';
import { Loader2, ScanBarcode, X } from 'lucide-react';

/**
 * Kamera-Barcode-Scanner (BarcodeDetector-API). Liefert den erkannten Code zurück.
 * Ohne Unterstützung bleibt die manuelle Eingabe im aufrufenden Feld.
 */
export function BarcodeScanner({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function stop() {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    async function start() {
      if (!('BarcodeDetector' in window)) {
        setError('Dieser Browser kann keine Barcodes scannen. Bitte Nummer eintippen.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
        });
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const raw = codes?.[0]?.rawValue;
            if (raw) {
              const code = String(raw).replace(/[^0-9]/g, '');
              if (code.length >= 6) {
                stop();
                onDetected(code);
                return;
              }
            }
          } catch {
            /* weiter scannen */
          }
          setTimeout(tick, 350);
        };
        setTimeout(tick, 600);
      } catch {
        setError('Kamera nicht verfügbar – bitte Barcode eintippen.');
      }
    }

    void start();
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-scrim p-4 text-on-scrim">
      <div className="mx-auto flex w-full max-w-md flex-col">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ScanBarcode className="h-5 w-5" /> Barcode scannen
          </h2>
          <button onClick={onClose} className="rounded-full bg-on-scrim/10 p-2" aria-label="Schließen">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} className="h-64 w-full object-cover" playsInline muted />
          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-on-scrim/80">
              <Loader2 className="h-4 w-4 animate-spin" /> Kamera startet …
            </div>
          )}
          {ready && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-28 w-72 rounded-xl border-2 border-on-scrim/70" />
            </div>
          )}
        </div>

        <p className="mt-2 text-center text-xs text-on-scrim/70">
          Barcode in den Rahmen halten – der Code wird automatisch übernommen.
        </p>
        {error && <p className="mt-2 rounded-lg border-l-2 border-warn bg-on-scrim/10 px-3 py-2 text-sm text-on-scrim">{error}</p>}
      </div>
    </div>
  );
}
