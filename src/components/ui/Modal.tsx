import { useEffect, type ReactNode } from 'react';

const SIZE_CLASS = { md: 'modal--md', lg: 'modal--lg', xl: 'modal--xl' } as const;

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}

export function Modal({ open, title, onClose, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className={`modal-overlay${open ? ' active' : ''}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${SIZE_CLASS[size]}`}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer modal-footer--actions">{footer}</div>}
      </div>
    </div>
  );
}
