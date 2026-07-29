import { useEffect } from 'react';
import { useStore } from '../state/store.js';

/**
 * Transient status toast, and — when `toastSticky` — a persistent error.
 *
 * Errors stay until dismissed on purpose: a provider failure explains what the
 * author has to fix (which model was refused, what needs enabling in AWS, which
 * region), and a 2-second toast is gone before that can be read or copied.
 */
export function Toast(): JSX.Element | null {
  const { toast, toastSticky, dismissToast } = useStore();

  // Escape dismisses a sticky error; transient toasts expire on their own.
  useEffect(() => {
    if (!toast || !toastSticky) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissToast();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toast, toastSticky, dismissToast]);

  if (!toast) return null;

  return (
    <div
      role={toastSticky ? 'alert' : 'status'}
      style={{
        position: 'fixed',
        bottom: 26,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        // Errors can run to several sentences, so let them wrap instead of
        // stretching off-screen the way a one-line toast would.
        maxWidth: toastSticky ? 'min(620px, calc(100vw - 48px))' : undefined,
        background: toastSticky ? '#241a1a' : '#1a1f1f',
        border: `1px solid ${toastSticky ? '#5e3535' : '#2a3332'}`,
        color: '#e9ecea',
        fontSize: 13.5,
        fontWeight: 500,
        lineHeight: 1.55,
        textAlign: 'left',
        padding: toastSticky ? '13px 13px 13px 16px' : '11px 18px',
        borderRadius: 11,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        animation: 'om-up .22s ease',
        zIndex: 50,
      }}
    >
      {toastSticky && (
        <span aria-hidden style={{ color: '#e0796f', fontWeight: 700, flex: '0 0 auto' }}>
          !
        </span>
      )}
      <span style={{ flex: '1 1 auto', minWidth: 0, whiteSpace: 'pre-wrap' }}>{toast}</span>
      {toastSticky && (
        <button
          onClick={dismissToast}
          title="Dismiss (Esc)"
          aria-label="Dismiss error"
          style={{
            flex: '0 0 auto',
            border: '1px solid #4a3030',
            background: 'transparent',
            color: '#c9a5a0',
            cursor: 'pointer',
            fontSize: 15,
            lineHeight: 1,
            padding: '4px 9px',
            borderRadius: 8,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
