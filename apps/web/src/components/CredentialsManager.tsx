import { useState } from 'react';
import { useStore } from '../state/store.js';
import type { Provider } from '@oread/shared';

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI' },
  { value: 'bedrock', label: 'AWS Bedrock' },
  { value: 'local', label: 'Local (Ollama)' },
];

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

/**
 * Provider-aware credential form. Anthropic/OpenAI need only an API key;
 * Cloudflare needs account id + token; Bedrock uses region (+ optional key);
 * local needs a base URL. Keys are sent once and encrypted server-side.
 */
export function CredentialsManager(): JSX.Element {
  const store = useStore();
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [accountId, setAccountId] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsSecret = provider !== 'local';
  const submit = async () => {
    setErr(null);
    if (!label.trim()) return setErr('Label required');
    if (provider === 'cloudflare' && !accountId.trim()) return setErr('Account ID required');
    if (provider === 'bedrock' && !region.trim()) return setErr('AWS region required');
    if (needsSecret && !secret.trim()) return setErr('API key required');
    setBusy(true);
    try {
      await store.addCredential({
        provider,
        label: label.trim(),
        secret: secret.trim() || undefined,
        // Cloudflare: accountId. Bedrock: AWS access key ID (also stored in accountId).
        accountId:
          provider === 'cloudflare' || provider === 'bedrock' ? accountId.trim() || undefined : undefined,
        region: provider === 'bedrock' ? region.trim() : undefined,
        baseUrl: provider === 'local' ? baseUrl.trim() : undefined,
      });
      setLabel('');
      setSecret('');
      setAccountId('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {/* existing credentials */}
      {store.credentialsList.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {store.credentialsList.map((c) => (
            <div
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#0f1212',
                border: '1px solid #1e2323',
                borderRadius: 8,
                padding: '7px 10px',
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#e9ecea' }}>
                  {c.label}
                </span>
                <span style={{ fontSize: 11, color: '#6d7473' }}>{c.provider}</span>
              </span>
              <button
                onClick={() => void store.removeCredential(c.id)}
                title="Delete credential"
                style={{ color: '#6d7473', fontSize: 14, padding: '0 6px' }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* add form */}
      <select
        value={provider}
        onChange={(e) => setProvider(e.target.value as Provider)}
        style={field}
      >
        {PROVIDERS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <input placeholder="Label (e.g. My Claude key)" value={label} onChange={(e) => setLabel(e.target.value)} style={field} />

      {provider === 'cloudflare' && (
        <input placeholder="Account ID" value={accountId} onChange={(e) => setAccountId(e.target.value)} style={field} />
      )}

      {/* Bedrock: AWS access key id + secret access key + region */}
      {provider === 'bedrock' && (
        <>
          <input
            placeholder="AWS access key ID"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            style={field}
          />
          <input
            type="password"
            placeholder="AWS secret access key"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            style={field}
          />
          <input placeholder="AWS region (e.g. us-east-1)" value={region} onChange={(e) => setRegion(e.target.value)} style={field} />
        </>
      )}

      {/* Anthropic / OpenAI / Cloudflare: single API key/token */}
      {needsSecret && provider !== 'bedrock' && (
        <input
          type="password"
          placeholder={provider === 'cloudflare' ? 'API token' : 'API key'}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          style={field}
        />
      )}

      {provider === 'local' && (
        <input placeholder="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={field} />
      )}
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
        Add credential
      </button>
    </div>
  );
}
