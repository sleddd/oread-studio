import { useStore } from '../state/store.js';

export function Toast(): JSX.Element | null {
  const { toast } = useStore();
  if (!toast) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 26,
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#1a1f1f',
        border: '1px solid #2a3332',
        color: '#e9ecea',
        fontSize: 13.5,
        fontWeight: 500,
        padding: '11px 18px',
        borderRadius: 11,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        animation: 'om-up .22s ease',
        zIndex: 50,
      }}
    >
      {toast}
    </div>
  );
}
