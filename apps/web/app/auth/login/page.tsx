'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
export default function Login() {
  const router = useRouter(); const [secret, setSecret] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret }) }); setBusy(false); if (!response.ok) { setError('Authentication failed. Check the local administrator secret.'); return; } router.push('/dashboard'); }
  return <main style={{ maxWidth: 480, margin: '12vh auto', padding: 32, background: 'white', borderRadius: 12, boxShadow: '0 8px 30px #17203314' }}><h1>AI application automation</h1><p>Local job discovery and application workspace.</p><form onSubmit={submit}><label htmlFor="secret">Administrator secret</label><input id="secret" type="password" value={secret} onChange={e => setSecret(e.target.value)} required style={{ display: 'block', width: '100%', margin: '8px 0 16px', padding: 10, boxSizing: 'border-box' }} /><button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>{error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}</form></main>;
}
