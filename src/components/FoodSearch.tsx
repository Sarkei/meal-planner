import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, ScanBarcode, Search } from 'lucide-react';
import { api } from '../lib/api';
import { BarcodeScanner } from './BarcodeScanner';

export type FoodHit = {
  barcode: string;
  name: string;
  brand: string;
  quantity: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  perQuantity: string;
};

/**
 * Zutatensuche über Open Food Facts (deutsche Produkte zuerst), Barcode-Feld und Kamera-Scanner.
 * Auswahl übernimmt Name plus Grammmenge in die Zutatenliste.
 */
export function FoodSearch({ onPick }: { onPick: (hit: FoodHit, grams: number) => void }) {
  const [query, setQuery] = useState('');
  const [barcode, setBarcode] = useState('');
  const [hits, setHits] = useState<FoodHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<FoodHit | null>(null);
  const [grams, setGrams] = useState(100);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setLoading(true);
      setMessage('');
      try {
        const res = await api<{ results: FoodHit[] }>(`/food/search?q=${encodeURIComponent(query.trim())}`);
        setHits(res.results.slice(0, 8));
        if (!res.results.length) setMessage('Kein Produkt gefunden – Namen frei eintragen.');
      } catch {
        setMessage('Suche nicht erreichbar – Namen frei eintragen.');
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [query]);

  async function lookupBarcode(code: string) {
    setLoading(true);
    setMessage('');
    try {
      const hit = await api<FoodHit>(`/food/barcode/${code}`);
      setScanned(hit);
      setGrams(100);
      setBarcode('');
      setQuery('');
      setHits([]);
    } catch {
      setMessage(`Kein Produkt zu ${code} gefunden.`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-2 rounded-xl border border-line/60 bg-surface/60 p-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-ink/35" />
          <input
            className="input !pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Zutat in der Lebensmittel-Datenbank suchen …"
          />
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-ink/40" />}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="relative flex-1">
          <ScanBarcode className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-ink/35" />
          <input
            className="input !pl-8"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const code = barcode.replace(/[^0-9]/g, '');
                if (code.length >= 6) void lookupBarcode(code);
              }
            }}
            placeholder="Barcode eintippen oder scannen (EAN)"
            inputMode="numeric"
          />
        </div>
        <button type="button" className="btn btn-ghost !px-3 !py-2 text-[12px]" onClick={() => setScanning(true)}>
          <Camera className="h-4 w-4" /> Scannen
        </button>
      </div>

      {message && <p className="mt-1 text-[11px] text-ink/50">{message}</p>}

      {scanned && (
        <div className="mt-2 rounded-lg border border-sage/40 bg-sage/10 p-2">
          <p className="text-[13px] font-semibold">{scanned.name}</p>
          <p className="text-[11px] text-ink/55">
            {scanned.brand || 'ohne Marke'} · {scanned.kcal ?? '—'} kcal / 100 g
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              value={grams}
              onChange={(e) => setGrams(Math.max(1, Number(e.target.value) || 1))}
              className="input !w-24 text-center"
            />
            <span className="text-[12px] text-ink/55">g</span>
            <button
              type="button"
              className="btn btn-primary !px-3 !py-1.5 text-[12px]"
              onClick={() => {
                const hit = scanned;
                if (!hit) return;
                onPick(hit, grams);
                setScanned(null);
                setMessage(`${hit.name} übernommen.`);
              }}
            >
              Als Zutat übernehmen
            </button>
            <button type="button" className="btn btn-ghost !px-2 !py-1.5 text-[12px]" onClick={() => setScanned(null)}>
              Verwerfen
            </button>
          </div>
        </div>
      )}

      {hits.length > 0 && (
        <ul className="mt-2 max-h-56 overflow-auto rounded-lg border border-line/60 bg-white/70">
          {hits.map((hit) => (
            <li key={hit.barcode + hit.name}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[13px] hover:bg-sage/10"
                onClick={() => {
                  onPick(hit, 100);
                  setQuery('');
                  setHits([]);
                }}
              >
                <span className="truncate">
                  {hit.name}
                  {hit.brand ? <span className="text-ink/45"> · {hit.brand}</span> : null}
                </span>
                <span className="shrink-0 text-[11px] text-ink/45">
                  {hit.kcal != null ? `${hit.kcal} kcal` : '—'} / {hit.perQuantity}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {scanning && (
        <BarcodeScanner
          onClose={() => setScanning(false)}
          onDetected={(code) => {
            setScanning(false);
            void lookupBarcode(code);
          }}
        />
      )}
    </div>
  );
}
