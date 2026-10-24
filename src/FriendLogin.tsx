import { useState, type FormEvent } from 'react';
import { ArrowRight, ArrowLeft, KeyRound } from 'lucide-react';
export function FriendLogin({ onLogin }: { onLogin: () => void }) {
  const [name, setName] = useState(''),
    [pin, setPin] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/friend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pin }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      onLogin();
    } catch (e) {
      setError((e as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="friend-login">
      <div className="brand">
        <span className="brand-mark">✳</span>
        <span>
          movie<span className="brand-light">night</span>.
        </span>
      </div>
      <div className="friend-login-card">
        <span className="eyebrow">THREE PEOPLE. ONE FRIDAY RITUAL.</span>
        <h1>{name ? `Hey, ${name}.` : 'Who’s here?'}</h1>
        <p>
          {name
            ? 'Enter your three-digit club code.'
            : 'Your taste, your watchlist, your next great movie.'}
        </p>
        {!name ? (
          <div className="friend-options">
            {['Chris', 'Matthew', 'Yash'].map((person, i) => (
              <button
                aria-label={`I am ${person}`}
                key={person}
                onClick={() => {
                  setName(person);
                  setError('');
                }}
              >
                <span className={`friend-avatar friend-${i}`}>{person[0]}</span>
                <span>I am {person}</span>
                <ArrowRight size={20} />
              </button>
            ))}
          </div>
        ) : (
          <form onSubmit={submit}>
            <label className="pin-label">
              <KeyRound size={18} />
              Club code
              <input
                aria-label="Three-digit club code"
                autoFocus
                inputMode="numeric"
                autoComplete="off"
                type="password"
                pattern="[0-9]{3}"
                maxLength={3}
                minLength={3}
                required
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="button lime full" disabled={busy || pin.length !== 3}>
              {busy ? 'Opening your seat…' : 'Let me in'}
              <ArrowRight size={18} />
            </button>
            <button
              type="button"
              className="text-button centered"
              onClick={() => {
                setName('');
                setPin('');
                setError('');
              }}
            >
              <ArrowLeft size={15} />
              Different person
            </button>
          </form>
        )}
        <div className="friend-login-foot">Same friends. New stories. No reruns.</div>
      </div>
    </div>
  );
}
