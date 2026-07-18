import { useState } from 'react';
import { auth } from '../api/index.js';
import { ApiError } from '../api/client.js';

export function AuthGate({ onAuthed }: { onAuthed: () => void }): JSX.Element {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        await auth.signup({ email, name, password });
      } else {
        await auth.login({ email, password, totp: totp || undefined });
      }
      onAuthed();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && (e.details as { totpRequired?: boolean })) {
        // handled by message below
      }
      const msg = e instanceof ApiError ? e.message : 'something went wrong';
      if (msg.includes('totp')) setNeedTotp(true);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const field = {
    width: '100%',
    background: '#0f1212',
    border: '1px solid #262b2b',
    borderRadius: 9,
    color: '#e9ecea',
    fontSize: 14,
    padding: '11px 13px',
    marginBottom: 10,
  } as const;

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0d0f0f',
        color: '#e9ecea',
      }}
    >
      <div style={{ width: 340 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, justifyContent: 'center' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent,#2e9d9d)', boxShadow: '0 0 10px var(--accent,#2e9d9d)' }} />
          <div style={{ fontWeight: 600, fontSize: 19, letterSpacing: '0.36em', color: '#f3f5f4' }}>OREAD</div>
        </div>
        <div
          style={{
            background: '#141818',
            border: '1px solid #262b2b',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
          }}
        >
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); }}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: 8,
                  fontSize: 13.5,
                  fontWeight: 600,
                  background: mode === m ? 'rgba(46,157,157,0.14)' : 'transparent',
                  color: mode === m ? 'var(--accent,#2e9d9d)' : '#6d7473',
                }}
              >
                {m === 'login' ? 'Log in' : 'Sign up'}
              </button>
            ))}
          </div>
          {mode === 'signup' && (
            <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={field} />
          )}
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
          <input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            style={field}
          />
          {needTotp && (
            <input
              placeholder="2FA code"
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              style={field}
            />
          )}
          {error && <div style={{ color: '#d1617f', fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
          <button
            onClick={() => void submit()}
            disabled={busy}
            style={{
              width: '100%',
              padding: '11px',
              borderRadius: 9,
              fontSize: 14,
              fontWeight: 700,
              color: '#04201f',
              background: 'var(--accent,#2e9d9d)',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </div>
      </div>
    </div>
  );
}
