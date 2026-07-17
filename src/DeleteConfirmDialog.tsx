import { AlertTriangle, Trash2, X } from 'lucide-react';

type DeleteConfirmDialogProps = {
  open: boolean;
  title: string;
  itemName: string;
  message: string;
  details?: string[];
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteConfirmDialog({
  open,
  title,
  itemName,
  message,
  details = [],
  confirmLabel = 'Delete',
  busy = false,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop delete-confirm-backdrop" onMouseDown={busy ? undefined : onCancel}>
      <section className="delete-confirm-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
        <div className="delete-confirm-icon"><AlertTriangle size={24} /></div>
        <button className="delete-confirm-close" type="button" onClick={onCancel} disabled={busy} aria-label="Close delete confirmation">
          <X size={18} />
        </button>
        <div className="delete-confirm-copy">
          <span>Destructive action</span>
          <h2 id="delete-confirm-title">{title}</h2>
          <p>{message}</p>
        </div>
        <div className="delete-confirm-target">
          <Trash2 size={18} />
          <div>
            <span>Target</span>
            <b>{itemName}</b>
          </div>
        </div>
        {details.length > 0 && (
          <ul className="delete-confirm-details">
            {details.map((detail) => <li key={detail}>{detail}</li>)}
          </ul>
        )}
        <div className="delete-confirm-actions">
          <button type="button" className="plain-button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="delete-confirm-button" onClick={onConfirm} disabled={busy}>
            <Trash2 size={15} /> {busy ? 'Deleting...' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
