import { useState } from 'react';
import { Modal } from './Modal';

/**
 * Bestätigung im eigenen Design statt window.confirm.
 *
 * window.confirm blockiert den Browser, lässt sich nicht gestalten und sieht auf
 * dem Handy fremd aus. Dieser Dialog nutzt das vorhandene Modal und ist per
 * Tastatur bedienbar (Escape = abbrechen).
 */
export function ConfirmDialog({
  title,
  text,
  confirmLabel = 'Bestätigen',
  cancelLabel = 'Abbrechen',
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  text: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Roter Knopf für nicht umkehrbare Aktionen. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [laeuft, setLaeuft] = useState(false);

  const bestaetigen = async () => {
    setLaeuft(true);
    try {
      await onConfirm();
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy || laeuft}>
            {cancelLabel}
          </button>
          <button
            className={danger ? 'btn bg-danger text-on-accent hover:bg-danger/90' : 'btn btn-primary'}
            onClick={() => void bestaetigen()}
            disabled={busy || laeuft}
            autoFocus
          >
            {laeuft ? '…' : confirmLabel}
          </button>
        </div>
      }
    >
      <p className="text-sm leading-relaxed text-ink/70">{text}</p>
    </Modal>
  );
}

/**
 * Kleiner Helfer: Zustand + Dialog in einem.
 *
 * ```tsx
 * const ask = useConfirm();
 * <button onClick={() => ask.oeffne({ title, text, onConfirm: ... })} />
 * {ask.dialog}
 * ```
 */
export function useConfirm() {
  const [offen, setOffen] = useState<{
    title: string;
    text: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const dialog = offen ? (
    <ConfirmDialog
      title={offen.title}
      text={offen.text}
      confirmLabel={offen.confirmLabel}
      danger={offen.danger}
      onConfirm={async () => {
        await offen.onConfirm();
        setOffen(null);
      }}
      onCancel={() => setOffen(null)}
    />
  ) : null;

  return {
    oeffne: (cfg: NonNullable<typeof offen>) => setOffen(cfg),
    dialog,
  };
}
