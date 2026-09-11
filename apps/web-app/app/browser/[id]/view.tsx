'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export default function BrowserView({ sourceId }: { sourceId: string }) {
  const endpoint = `/api/sources/${encodeURIComponent(sourceId)}/browser`;
  const [frame, setFrame] = useState(''); const [url, setUrl] = useState('');
  const [destination, setDestination] = useState(''); const [text, setText] = useState('');
  const [active, setActive] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch(`${endpoint}?frame=1`, { cache: 'no-store' });
      const body = await response.json();
      if (response.ok) { setFrame(`data:image/jpeg;base64,${body.data.image}`); setUrl(body.data.url); setActive(true); }
      else if (response.status === 404) { setActive(false); setFrame(''); }
      else if (response.status !== 409) setError(body.error?.message ?? 'Unable to load browser.');
    } catch { setError('Unable to connect to the local browser.'); }
    finally { inFlight.current = false; }
  }, [endpoint]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!active) return; const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 1500); return () => clearInterval(timer); }, [active, refresh]);
  async function act(action: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    while (inFlight.current) await new Promise(resolve => setTimeout(resolve, 50));
    inFlight.current = true; setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Browser action failed.');
      if (action.action === 'finish') { setActive(false); setFrame(''); }
      else setActive(true);
    } catch (error) { setError(error instanceof Error ? error.message : 'Browser action failed.'); }
    finally { inFlight.current = false; setBusy(false); }
    if (action.action !== 'finish') await refresh();
  }
  return <main style={{ maxWidth: 1320, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
    <a href="/dashboard">← Dashboard</a><h1>Source browser</h1>
    <p>Open the browser, sign in to the website, then choose “Save session and release to agent”. The scraper uses this source’s saved cookies and browser storage. Release the browser before queueing a scan. Sources with an open user session are skipped with a busy-session error. Idle sessions close after 15 minutes.</p>
    <p>Click the image to focus a website field. Enter text below to send it to that field; use Tab and Enter to navigate forms. For SSO, add the login provider’s origin to the source’s allowed origins first.</p>
    {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      <button disabled={busy || active} onClick={() => act({ action: 'open' })}>{busy && !active ? 'Opening…' : 'Open browser'}</button>
      <button disabled={busy || !active} onClick={() => act({ action: 'finish' })}>Save session and release to agent</button>
      <button disabled={busy || !active} onClick={() => act({ action: 'back' })}>Back</button>
    </div>
    {active && <>
      <form onSubmit={event => { event.preventDefault(); void act({ action: 'navigate', url: destination }); }} style={{ display: 'flex', gap: 8 }}>
        <input aria-label="Website URL" value={destination} onChange={event => setDestination(event.target.value)} placeholder="Navigate to an allowed website URL" style={{ flex: 1 }} /><button disabled={busy || !destination}>Go</button>
      </form>
      <p style={{ overflowWrap: 'anywhere' }}>Current page: {url}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input type="password" autoComplete="off" aria-label="Text to send to focused website field" value={text} onChange={event => setText(event.target.value)} placeholder="Text to send to focused field" />
        <button disabled={busy || !text} onClick={() => { void act({ action: 'type', text }); setText(''); }}>Send text</button>
        {['Tab', 'Shift+Tab', 'Enter', 'Backspace', 'ControlOrMeta+A', 'Escape', 'Space'].map(key => <button key={key} disabled={busy} onClick={() => act({ action: 'key', key })}>{key === 'ControlOrMeta+A' ? 'Select all' : key}</button>)}
        <button disabled={busy} onClick={() => act({ action: 'scroll', delta: -600 })}>Scroll up</button><button disabled={busy} onClick={() => act({ action: 'scroll', delta: 600 })}>Scroll down</button>
      </div>
      {frame && <img src={frame} alt="Interactive source website; click to focus a field or activate a control" width={1280} height={800} style={{ width: '100%', height: 'auto', border: '1px solid #d0d5dd', cursor: busy ? 'wait' : 'pointer' }} onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        void act({ action: 'click', x: Math.min(1279, Math.max(0, (event.clientX - rect.left) * 1280 / rect.width)), y: Math.min(799, Math.max(0, (event.clientY - rect.top) * 800 / rect.height)) });
      }} />}
    </>}
  </main>;
}
