import { useState } from 'react';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { loginWithCode } from '../api/client';

export function LoginGate({ onAuthed }: { onAuthed: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await loginWithCode(code);
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-6">
      <div className="w-full max-w-[420px] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--emerald)]">
            <KeyRound size={18} />
          </span>
          <div>
            <h1 className="font-semibold tracking-[0.18em] text-[var(--text)]">BLINKO//OS</h1>
            <p className="text-[11px] text-[var(--muted)]">PC WAR ROOM · SESSION GATE</p>
          </div>
        </div>

        <p className="mt-7 text-[13px] leading-relaxed text-[var(--hint)]">
          Send <code className="mono rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[12px] text-[var(--emerald)]">/web</code> to your Telegram bot.
          Then enter the 8-character one-time code below, or open the magic link it replies with.
        </p>

        <label className="mt-6 block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
          One-time code
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
            placeholder="XXXX-XXXX"
            autoFocus
            spellCheck={false}
            className="mono mt-2 w-full rounded-md border border-[var(--border-strong)] bg-[#0b0f12] px-3 py-2.5 text-center text-[18px] tracking-[0.25em] text-[var(--text)] outline-none placeholder:text-[#3a4650] focus:border-[var(--emerald)]"
          />
        </label>

        {error ? <p className="mt-3 text-[12px] text-[var(--rose)]">{error}</p> : null}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || code.replace(/[^A-Z0-9]/g, '').length !== 8}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-[var(--emerald)] px-4 py-2.5 text-[13px] font-semibold text-[#05130d] transition hover:brightness-110 disabled:opacity-40"
        >
          {busy ? <LoaderCircle size={15} className="animate-spin" /> : null}
          Unlock War Room
        </button>

        <p className="mt-5 text-[11px] text-[var(--muted)]">
          Codes expire in 60 seconds and are single-use. The session cookie is HttpOnly and lasts 30 days.
        </p>
      </div>
    </div>
  );
}
