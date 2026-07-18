import { useState } from 'react';
import { auth } from '../api/index.js';
import { ApiError } from '../api/client.js';
import { useStore } from '../state/store.js';

const field = {
  width: '100%',
  background: '#0f1212',
  border: '1px solid #262b2b',
  borderRadius: 8,
  color: '#e9ecea',
  fontSize: 13,
  padding: '8px 10px',
  marginBottom: 8,
} as const;

/** Change the logged-in user's password. Verifies the current one server-side. */
export function ChangePassword(): JSX.Element {
  const store = useStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(null);
    if (next.length < 8) return setErr('New password must be at least 8 characters');
    if (next !== confirm) return setErr('New passwords do not match');
    setBusy(true);
    try {
      await auth.changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      store.showToast('Password changed');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'failed to change password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input
        type="password"
        placeholder="Current password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        style={field}
      />
      <input
        type="password"
        placeholder="New password (min 8)"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        style={field}
      />
      <input
        type="password"
        placeholder="Confirm new password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        style={field}
      />
      {err && <div style={{ color: '#d1617f', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <button
        onClick={() => void submit()}
        disabled={busy}
        style={{
          width: '100%',
          padding: '9px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 700,
          color: '#04201f',
          background: 'var(--accent,#2e9d9d)',
          opacity: busy ? 0.6 : 1,
        }}
      >
        Change password
      </button>
    </div>
  );
}
