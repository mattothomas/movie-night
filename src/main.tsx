import React, { useState, useEffect, useRef, type FormEvent, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Plus,
  X,
  Check,
  CheckCheck,
  ChevronRight,
  ChevronDown,
  Clapperboard,
  CalendarDays,
  Users,
  Sparkles,
  Disc3,
  LayoutDashboard,
  Bookmark,
  Search,
  Clock3,
  LogOut,
  Settings,
  Star,
  Heart,
  ThumbsUp,
  Meh,
  ThumbsDown,
  RotateCcw,
  Play,
  Film,
  Copy,
  Upload,
  ListFilter,
  Volume2,
  SkipForward,
} from 'lucide-react';
import type { State, Movie, Member, Night, Reaction } from './types';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-800.css';
import './styles.css';

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    `/api${path}`,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
const colors = ['#d5ec97', '#b8b0df', '#f2bc8d', '#9dcbd0', '#e3a9b9', '#d0c1a2'];
function Avatar({
  member,
  index = 0,
  small = false,
}: {
  member?: Member;
  index?: number;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${small ? 'small' : ''}`}
      style={{ '--avatar': colors[index % colors.length] } as CSSProperties}
    >
      {member?.username.slice(0, 1).toUpperCase() || '?'}
    </span>
  );
}
function Poster({ movie, large = false }: { movie: Movie; large?: boolean }) {
  let hash = 0;
  for (const c of movie.id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const variant = hash % 6;
  return (
    <div
      className={`poster art-${variant} ${large ? 'large' : ''}`}
      aria-label={`${movie.title} illustrated title card`}
    >
      <div className="poster-noise" />
      <div className="poster-shape shape-a" />
      <div className="poster-shape shape-b" />
      <div className="poster-shape shape-c" />
      <span className="poster-edition">A MOVIE NIGHT SELECTION</span>
      <div className="poster-title">{movie.title}</div>
      <div className="poster-bottom">
        <span>{movie.year}</span>
        <span>✳</span>
        <span>ENGLISH</span>
      </div>
    </div>
  );
}
function App() {
  const [auth, setAuth] = useState<boolean | null>(null),
    [state, setState] = useState<State | null>(null),
    [page, setPage] = useState('home'),
    [toast, setToast] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<'starter' | 'weekly' | null>(null),
    [rate, setRate] = useState<Night | null>(null),
    [detail, setDetail] = useState<Movie | null>(null),
    [settings, setSettings] = useState(false);
  const mounted = useRef(true);
  async function refresh() {
    try {
      const s = await api<State>('/state');
      if (mounted.current) setState(s);
    } catch (e) {
      if ((e as Error).message === 'Please sign in.') setAuth(false);
      else setError((e as Error).message);
    }
  }
  useEffect(() => {
    api('/auth')
      .then((d) => setAuth(!!d.user))
      .catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (auth) {
      mounted.current = true;
      refresh();
      const timer = setInterval(refresh, 5000);
      return () => clearInterval(timer);
    }
  }, [auth]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  async function action(path: string, body: unknown = {}, message = '') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api(path, body);
      await refresh();
      if (message) setToast(message);
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const notice = (
    <>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={17} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </>
  );
  if (auth === null)
    return (
      <div className="loading-screen">
        <div className="brand-mark">✳</div>
        <span>Setting the scene…</span>
        {notice}
      </div>
    );
  if (!auth)
    return (
      <>
        <Auth
          onLogin={() => {
            setAuth(true);
            setError('');
          }}
        />
        {notice}
      </>
    );
  if (!state)
    return (
      <div className="loading-screen">
        <div className="brand-mark">✳</div>Opening your club…{notice}
      </div>
    );
  const s = state;
  const eligible = s.movies.filter((m) => m.eligible);
  const completed = s.nights.filter((n) => n.status === 'completed');
  const nav = [
    { id: 'home', label: 'The clubhouse', icon: LayoutDashboard },
    { id: 'tonight', label: 'This Friday', icon: Disc3 },
    { id: 'discover', label: 'Discover movies', icon: Sparkles },
    { id: 'queues', label: 'Our watchlists', icon: Bookmark },
    { id: 'history', label: 'Past Fridays', icon: Clapperboard },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage('home')}>
          <span className="brand-mark">✳</span>
          <span>
            movie<span className="brand-light">night</span>
            <span className="brand-period">.</span>
          </span>
        </button>
        <div className="club-switch">
          <span className="club-icon">
            <Film size={19} />
          </span>
          <span>
            {s.group.name}
            <small>THE GOOD COMPANY CLUB</small>
          </span>
          <button onClick={() => setSettings(true)} aria-label="Group settings">
            <ChevronDown size={15} />
          </button>
        </div>
        <div className="nav-label">YOUR FRIDAY RITUAL</div>
        <nav>
          {nav.map((n) => (
            <button
              className={page === n.id ? 'active' : ''}
              key={n.id}
              title={n.label}
              onClick={() => setPage(n.id)}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === 'tonight' && <span className="nav-dot" />}
              {n.id === 'queues' && (
                <span className="nav-count">
                  {s.movies.filter((m) => m.queuedBy.length).length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="club-rule">
            <span>THE ONLY RULE</span>
            <p>
              New to everyone.
              <br />
              Good for everyone.
            </p>
            <span className="rule-star">✳</span>
          </div>
          <button className="settings-link" onClick={() => setSettings(true)}>
            <Settings size={18} />
            Group & settings
          </button>
          <button className="profile" onClick={() => setSettings(true)}>
            <Avatar member={s.user} />
            <span>
              {s.user.username}
              <small>{s.group.demo ? 'EXPLORING THE DEMO' : 'READY FOR FRIDAY'}</small>
            </span>
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            Your little corner of cinema <span>/</span>{' '}
            <b>{nav.find((n) => n.id === page)?.label}</b>
          </span>
          <div className="topbar-right">
            {!!s.group.demo && <span className="demo-label">DEMO CLUB</span>}
            <span className="live-pill">
              <i /> Friday people
            </span>
            <button
              className="avatar-stack"
              aria-label="Open group settings"
              onClick={() => setSettings(true)}
            >
              {s.members.map((m, i) => (
                <Avatar key={m.id} member={m} index={i} small />
              ))}
            </button>
          </div>
        </header>
        <main>
          {page === 'home' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">GOOD FILMS. BETTER COMPANY.</div>
                  <h1>
                    Friday looks good <em>on you.</em>
                  </h1>
                  <p>Less “have you seen it?” More press play.</p>
                </div>
                <button className="date-badge" onClick={() => setPage('tonight')}>
                  <CalendarDays size={18} />
                  {formatDate(s.night.date)}
                  <ArrowUpRight size={16} />
                </button>
              </div>
              <div className="home-grid">
                <div className="home-main">
                  <section className="hero">
                    <div className="hero-text">
                      <span className="pill">
                        <span className="little-star">✳</span> EVERYONE’S NEXT FAVORITE
                      </span>
                      <h2>
                        Three friends.
                        <br />
                        One screen.
                        <br />
                        <em>Zero reruns.</em>
                      </h2>
                      <p>
                        A little less scrolling.
                        <br />A whole lot more movie night.
                      </p>
                      <button className="button lime" onClick={() => setPage('discover')}>
                        Find our next movie
                        <ArrowUpRight size={17} />
                      </button>
                    </div>
                    <div className="hero-art" aria-hidden="true">
                      <div className="orbit orbit-one" />
                      <div className="orbit orbit-two" />
                      <div className="hero-ticket ticket-back">
                        <span>ADMIT THREE</span>
                        <b>
                          FRIDAY
                          <br />
                          FILM CLUB
                        </b>
                        <div className="ticket-stub">NO RERUNS · JUST GOOD COMPANY</div>
                      </div>
                      <div className="hero-ticket ticket-front">
                        <span className="ticket-top">
                          THE FRIDAY SPECIAL <span>✳</span>
                        </span>
                        <div className="ticket-sun" />
                        <b>
                          MAKE IT
                          <br />A MOVIE
                          <br />
                          <i>NIGHT.</i>
                        </b>
                        <span className="ticket-serial">EST. EVERY FRIDAY &nbsp; • &nbsp; 001</span>
                      </div>
                      <span className="hero-spark spark-one">✳</span>
                      <span className="hero-spark spark-two">✳</span>
                      <span className="hero-caption">SAME PEOPLE. NEW STORIES.</span>
                    </div>
                  </section>
                  <section className="recommendations">
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">THE NEXT GREAT FRIDAY</span>
                        <h2>
                          Fresh for all of us <span className="count-pill">{eligible.length}</span>
                        </h2>
                      </div>
                      <button className="text-button" onClick={() => setPage('discover')}>
                        View all <ArrowUpRight size={16} />
                      </button>
                    </div>
                    <div className="movie-grid home-movies">
                      {eligible.slice(0, 4).map((m) => (
                        <MovieCard
                          key={m.id}
                          movie={m}
                          onOpen={() => setDetail(m)}
                          onQueue={() =>
                            action(
                              '/preferences',
                              { movieId: m.id, queued: !m.queued },
                              m.queued ? 'Removed from your watchlist' : 'Added to your watchlist'
                            )
                          }
                        />
                      ))}
                    </div>
                    {!eligible.length && (
                      <Empty
                        title="Time for a new batch"
                        text="Import more English-language movies in group settings."
                      />
                    )}
                  </section>
                </div>
                <div className="home-side">
                  <TonightCard s={s} onOpen={() => setPage('tonight')} />
                  <section className="panel tune-panel">
                    <div className="mini-icon">
                      <Sparkles size={21} />
                    </div>
                    <span className="eyebrow">A LITTLE TASTE CHECK</span>
                    <h3>
                      Make the next pick
                      <br />
                      <em>even better.</em>
                    </h3>
                    <p>
                      20 movies. Your honest reactions.
                      <br />
                      Your group’s next favorites.
                    </p>
                    <button className="button outline" onClick={() => setReview('weekly')}>
                      Do the Friday 20 <ArrowRight size={16} />
                    </button>
                    <div className="tiny-note">No spoilers. Just gut feelings.</div>
                  </section>
                </div>
              </div>
              <div className="bottom-strip">
                <span className="strip-star">✳</span>
                <span>
                  <b>One rule. A hundred possibilities.</b> If someone’s seen it, it’s off the
                  table.
                </span>
                <button className="text-button" onClick={() => setReview('starter')}>
                  Build my movie memory <ArrowUpRight size={16} />
                </button>
              </div>
            </>
          )}
          {page === 'tonight' && (
            <Tonight
              s={s}
              action={action}
              busy={busy}
              onBrowse={() => setPage('discover')}
              onRate={setRate}
            />
          )}
          {page === 'discover' && (
            <Discover
              s={s}
              onOpen={setDetail}
              onQueue={(m) =>
                action(
                  '/preferences',
                  { movieId: m.id, queued: !m.queued },
                  m.queued ? 'Removed from your watchlist' : 'Added to your watchlist'
                )
              }
              onReview={() => setReview('weekly')}
            />
          )}
          {page === 'queues' && (
            <Queues s={s} onOpen={setDetail} action={action} onBrowse={() => setPage('discover')} />
          )}
          {page === 'history' && (
            <>
              <PageHeading
                eyebrow="THE FRIDAY ARCHIVE"
                title="Good nights, on record."
                text="Every pick. Every opinion. Your growing collection of Fridays."
              />
              {completed.length ? (
                <div className="history-list">
                  {completed.map((n) => (
                    <HistoryCard key={n.id} night={n} s={s} onRate={() => setRate(n)} />
                  ))}
                </div>
              ) : (
                <Empty
                  title="Your first Friday is waiting"
                  text="Finish a movie night and it’ll live here, along with everyone’s ratings."
                  action={
                    <button className="button lime" onClick={() => setPage('tonight')}>
                      Plan our first night <ArrowRight size={16} />
                    </button>
                  }
                />
              )}
            </>
          )}
          <footer>
            <span>✳ &nbsp; A Friday worth looking forward to.</span>
            <span>MADE FOR YOUR KIND OF MOVIE PEOPLE</span>
          </footer>
        </main>
      </div>
      {notice}
      {review && (
        <Review s={s} mode={review} onClose={() => setReview(null)} action={action} />
      )}{' '}
      {detail && (
        <MovieDetail
          movie={s.movies.find((m) => m.id === detail.id) || detail}
          s={s}
          onClose={() => setDetail(null)}
          action={action}
          busy={busy}
        />
      )}{' '}
      {rate && (
        <RateModal
          night={s.nights.find((n) => n.id === rate.id) || rate}
          s={s}
          onClose={() => setRate(null)}
          action={action}
        />
      )}{' '}
      {settings && (
        <SettingsModal
          s={s}
          onClose={() => setSettings(false)}
          action={action}
          onLogout={async () => {
            await api('/auth/logout', {});
            setSettings(false);
            setPage('home');
            setState(null);
            setAuth(false);
          }}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
function formatDate(date: string) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
function PageHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}
function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <Film size={32} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = ref.current;
    el?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const controls = Array.from(
          el.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input,select,a[href],[tabindex="0"]'
          )
        ).filter((x) => x.offsetParent !== null);
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener('keydown', listener);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-header">
          <span className="eyebrow">{title}</span>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Auth({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<'register' | 'login'>('register'),
    [join, setJoin] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(`/auth/${mode}`, fields);
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <div className="brand">
          <span className="brand-mark">✳</span>
          <span>
            movie<span className="brand-light">night</span>.
          </span>
        </div>
        <div className="auth-copy">
          <div className="eyebrow">YOUR FRIDAY RITUAL, SORTED.</div>
          <h1>
            Your people.
            <br />A new movie.
            <br />
            <em>A very good night.</em>
          </h1>
          <p>
            Find something nobody’s seen.
            <br />
            Let the wheel pick your picker.
            <br />
            Make every Friday a little better.
          </p>
          <div className="auth-ticket">
            <span>ADMIT YOUR FAVORITE PEOPLE</span>
            <b>
              THE FRIDAY FILM CLUB <span>✳</span>
            </b>
            <small>ONE RULE: NO RERUNS.</small>
          </div>
        </div>
        <span className="eyebrow">GOOD FILMS. BETTER COMPANY.</span>
      </section>
      <section className="auth-form-area">
        <div className="auth-form">
          <span className="eyebrow">SAVE YOUR FRIDAY SEAT</span>
          <h2>{mode === 'register' ? 'Make yourself at home.' : 'Welcome back.'}</h2>
          <p>
            {mode === 'register'
              ? 'Your next favorite Friday starts here.'
              : 'The club saved you a seat.'}
          </p>
          <div className="segmented">
            <button
              className={mode === 'register' ? 'selected' : ''}
              onClick={() => setMode('register')}
            >
              Create an account
            </button>
            <button className={mode === 'login' ? 'selected' : ''} onClick={() => setMode('login')}>
              Sign in
            </button>
          </div>
          <form onSubmit={submit}>
            <label>
              Username
              <input
                name="username"
                required
                autoComplete="username"
                pattern="[a-zA-Z0-9_]{2,24}"
                placeholder="Your name in the credits"
                maxLength={24}
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                minLength={mode === 'register' ? 10 : 1}
                maxLength={128}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'}
              />
            </label>
            {mode === 'register' && (
              <>
                <div className="join-options">
                  <button
                    type="button"
                    className={!join ? 'active' : ''}
                    onClick={() => setJoin(false)}
                  >
                    Start our club
                  </button>
                  <button
                    type="button"
                    className={join ? 'active' : ''}
                    onClick={() => setJoin(true)}
                  >
                    Join my friends
                  </button>
                </div>
                {join ? (
                  <label>
                    Invite code
                    <input name="invite" required placeholder="Ask a friend for your club’s code" />
                  </label>
                ) : (
                  <label>
                    Club name
                    <input name="groupName" placeholder="The Friday Club" maxLength={60} />
                  </label>
                )}
              </>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="button lime full" disabled={busy}>
              {busy
                ? 'Saving your seat…'
                : mode === 'register'
                  ? 'Let’s make it a movie night'
                  : 'Back to the clubhouse'}
              <ArrowRight size={18} />
            </button>
          </form>
          <div className="auth-divider">
            <span>OR TAKE A LOOK AROUND</span>
          </div>
          <button
            className="button outline full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api('/auth/demo', {});
                onLogin();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Explore a demo club <ArrowUpRight size={17} />
          </button>
          <p className="auth-note">
            A private space for your people. No social feed.
            <br />
            No spoilers. No more “have you seen it?”
          </p>
        </div>
      </section>
    </div>
  );
}
function MovieCard({
  movie: m,
  onOpen,
  onQueue,
}: {
  movie: Movie;
  onOpen: () => void;
  onQueue: () => void;
}) {
  return (
    <article className="movie-card">
      <button className="poster-button" onClick={onOpen}>
        <Poster movie={m} />
        {m.queuedBy.length > 0 && (
          <span className="poster-tag">
            <Bookmark size={11} /> ON THE LIST
          </span>
        )}
      </button>
      <button
        className={`save-movie ${m.queued ? 'saved' : ''}`}
        aria-label={`${m.queued ? 'Remove' : 'Add'} ${m.title} ${m.queued ? 'from' : 'to'} watchlist`}
        onClick={onQueue}
      >
        <Bookmark size={16} fill={m.queued ? 'currentColor' : 'none'} />
      </button>
      <button className="movie-title" onClick={onOpen}>
        {m.title}
      </button>
      <div className="movie-meta">
        <span>{m.year}</span>
        <span>·</span>
        <span>{m.runtime ? `${m.runtime} min` : 'English'}</span>
        {m.eligible && <CheckCheck size={14} />}
      </div>
    </article>
  );
}
function TonightCard({ s, onOpen }: { s: State; onOpen: () => void }) {
  const winner = s.members.find((m) => m.id === s.night.winner_id);
  return (
    <section className="panel tonight-card">
      <div className="section-heading">
        <span className="eyebrow">THIS FRIDAY’S LINEUP</span>
        <span className="status-pill">
          <i />
          {s.night.status === 'watching' ? 'NOW WATCHING' : 'IT’S A DATE'}
        </span>
      </div>
      <div className="tonight-date">
        <span>
          {new Date(s.night.date + 'T12:00:00')
            .toLocaleDateString('en-US', { month: 'short' })
            .toUpperCase()}
        </span>
        <b>{new Date(s.night.date + 'T12:00:00').getDate()}</b>
        <div>
          <h3>{winner ? `${winner.username}’s pick.` : 'Who’s got the pick?'}</h3>
          <p>{winner ? 'A new story is waiting.' : 'Let a little luck decide.'}</p>
        </div>
      </div>
      <div className="member-row">
        {s.members.map((m, i) => (
          <div
            className={`member-item ${!s.night.attendees.includes(m.id) ? 'absent' : ''}`}
            key={m.id}
          >
            <div>
              <Avatar member={m} index={i} />
              {s.night.attendees.includes(m.id) && <span className="attending-dot" />}
            </div>
            <span>{m.username}</span>
          </div>
        ))}
      </div>
      <button className="button light full" onClick={onOpen}>
        {winner ? 'Plan the night' : 'Meet the wheel'}
        <ArrowUpRight size={17} />
      </button>
      <div className="tiny-note">
        {s.night.attendees.length} friends.{' '}
        {s.night.mode === 'equal' ? 'Equal chances.' : 'Taste-weighted chances.'} One good night.
      </div>
    </section>
  );
}
type Action = (path: string, body?: unknown, message?: string) => Promise<any>;
function Discover({
  s,
  onOpen,
  onQueue,
  onReview,
}: {
  s: State;
  onOpen: (m: Movie) => void;
  onQueue: (m: Movie) => void;
  onReview: () => void;
}) {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('eligible'),
    [genre, setGenre] = useState('All genres');
  const movies = s.movies.filter(
    (m) =>
      (filter === 'all' ||
        (filter === 'seen' && m.reaction.startsWith('seen')) ||
        (filter === 'eligible' && m.eligible)) &&
      (genre === 'All genres' || m.genres.includes(genre)) &&
      m.title.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <>
      <PageHeading
        eyebrow="FIND YOUR NEXT FRIDAY"
        title="Something new. For everyone."
        text="Your group’s next movies, all in one place."
      />
      <div className="discovery-toolbar">
        <div className="segmented compact">
          <button
            className={filter === 'eligible' ? 'selected' : ''}
            onClick={() => setFilter('eligible')}
          >
            Fresh for us <span>{s.movies.filter((m) => m.eligible).length}</span>
          </button>
          <button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>
            All movies
          </button>
          <button className={filter === 'seen' ? 'selected' : ''} onClick={() => setFilter('seen')}>
            My seen movies
          </button>
        </div>
        <button className="button outline" onClick={onReview}>
          <Sparkles size={16} />
          Friday 20
        </button>
      </div>
      <div className="search-row">
        <div className="search-field">
          <Search size={18} />
          <input
            aria-label="Search movies"
            placeholder="Find a movie…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter by genre"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
        >
          {['All genres', ...new Set(s.movies.flatMap((m) => m.genres))].map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <span className="results-label">{movies.length} movies</span>
      </div>
      <div className="movie-grid discover-grid">
        {movies.map((m) => (
          <MovieCard key={m.id} movie={m} onOpen={() => onOpen(m)} onQueue={() => onQueue(m)} />
        ))}
      </div>
      {!movies.length && (
        <Empty
          title="No movies here yet"
          text="Try another search or import more titles in group settings."
        />
      )}
      <div className="catalog-note">
        <Film size={16} /> Curated English-language starter library. Import an IMDb CSV in group
        settings to add your IMDb list. This is not a live IMDb ranking.
      </div>
    </>
  );
}
function Queues({
  s,
  onOpen,
  action,
  onBrowse,
}: {
  s: State;
  onOpen: (m: Movie) => void;
  action: Action;
  onBrowse: () => void;
}) {
  const [member, setMember] = useState(s.user.id);
  const movies = s.movies
    .filter((m) => m.queuedBy.some((q) => q.id === member))
    .sort(
      (a, b) =>
        Number(b.queuedBy.find((q) => q.id === member)?.priority) -
        Number(a.queuedBy.find((q) => q.id === member)?.priority)
    );
  return (
    <>
      <PageHeading
        eyebrow="SAVE IT FOR A GOOD FRIDAY"
        title="Your taste. Our watchlists."
        text="Personal little collections. Plenty of shared possibilities."
      />
      <div className="queue-members">
        {s.members.map((m, i) => (
          <button
            className={member === m.id ? 'selected' : ''}
            key={m.id}
            onClick={() => setMember(m.id)}
          >
            <Avatar member={m} index={i} small />
            {m.id === s.user.id ? 'My watchlist' : `${m.username}’s list`}
            <span>
              {s.movies.filter((movie) => movie.queuedBy.some((q) => q.id === m.id)).length}
            </span>
          </button>
        ))}
      </div>
      {movies.length ? (
        <div className="queue-list">
          {movies.map((m, i) => (
            <article key={m.id} className="queue-row">
              <span className="queue-number">{String(i + 1).padStart(2, '0')}</span>
              <button className="queue-poster" onClick={() => onOpen(m)}>
                <Poster movie={m} />
              </button>
              <div className="queue-info">
                <button onClick={() => onOpen(m)}>{m.title}</button>
                <p>
                  {m.year} <span>·</span> {m.runtime} min
                </p>
                <span className={m.eligible ? 'eligible-label' : 'blocked-label'}>
                  {m.eligible ? <CheckCheck size={13} /> : <Check size={13} />}{' '}
                  {m.eligible ? 'Fresh for everyone attending' : 'Someone attending has seen it'}
                </span>
              </div>
              {member === s.user.id ? (
                <>
                  <button
                    className={`priority-button ${m.priority ? 'selected' : ''}`}
                    onClick={() =>
                      action(
                        '/preferences',
                        { movieId: m.id, priority: !m.priority },
                        m.priority ? 'Back in the queue' : 'Moved to the top of your queue'
                      )
                    }
                  >
                    <ArrowUpRight size={16} />
                    <span>{m.priority ? 'Top of my queue' : 'Move to top'}</span>
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${m.title}`}
                    onClick={() =>
                      action(
                        '/preferences',
                        { movieId: m.id, queued: false },
                        'Removed from your watchlist'
                      )
                    }
                  >
                    <X size={18} />
                  </button>
                </>
              ) : (
                m.queuedBy.find((q) => q.id === member)?.priority && (
                  <span className="subtle-tag">TOP OF THE QUEUE</span>
                )
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="A watchlist with possibilities"
          text="Save a movie in Discover and it’ll be waiting right here."
          action={
            <button className="button lime" onClick={onBrowse}>
              Find a movie <ArrowRight size={16} />
            </button>
          }
        />
      )}
    </>
  );
}
function Tonight({
  s,
  action,
  busy,
  onBrowse,
  onRate,
}: {
  s: State;
  action: Action;
  busy: boolean;
  onBrowse: () => void;
  onRate: (n: Night) => void;
}) {
  const n = s.night;
  const [spinning, setSpinning] = useState(false),
    [rotation, setRotation] = useState(0),
    [reveal, setReveal] = useState(true);
  const winner = s.members.find((m) => m.id === n.winner_id);
  const movie = s.movies.find((m) => m.id === n.movie_id);
  const selectedMembers = s.members.filter((m) => n.attendees.includes(m.id));
  const stops = s.weights
    .map((w, i) => {
      const start = s.weights.slice(0, i).reduce((sum, a) => sum + a.chance, 0);
      return `${colors[s.members.findIndex((m) => m.id === w.id) % colors.length]} ${start}% ${start + w.chance}%`;
    })
    .join(',');
  const spinTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(spinTimer.current), []);
  async function spin() {
    if (spinning || busy) return;
    setSpinning(true);
    setReveal(false);
    const result = await action('/night/spin');
    if (!result) {
      setSpinning(false);
      setReveal(true);
      return;
    }
    const idx = s.weights.findIndex((w) => w.id === result.winnerId);
    const middle =
      s.weights.slice(0, idx).reduce((a, b) => a + b.chance, 0) + s.weights[idx].chance / 2;
    setRotation(1800 + (360 - middle * 3.6));
    spinTimer.current = setTimeout(() => {
      setSpinning(false);
      setReveal(true);
    }, 4300);
  }
  const last = s.nights.find(
    (x) =>
      x.status === 'completed' &&
      x.attendees.includes(s.user.id) &&
      !x.ratings.some((r) => r.user_id === s.user.id)
  );
  return (
    <>
      <PageHeading
        eyebrow="SAME PEOPLE. NEW STORIES."
        title="Make a night of it."
        text="Set the lineup. Spin for the picker. Press play."
      />
      {last && (
        <div className="pending-rating">
          <Star size={18} />
          <span>
            You still have a review to give for{' '}
            {s.movies.find((m) => m.id === last.movie_id)?.title}.
          </span>
          <button className="text-button" onClick={() => onRate(last)}>
            Rate the night <ArrowRight size={16} />
          </button>
        </div>
      )}
      <div className="tonight-layout">
        <section className="panel wheel-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">A LITTLE LUCK GOES A LONG WAY</span>
              <h2>The picker picker.</h2>
            </div>
            <Disc3 size={22} />
          </div>
          <div className="segmented">
            <button
              disabled={!!winner || busy}
              className={n.mode === 'equal' ? 'selected' : ''}
              onClick={() =>
                action('/night/settings', { attendees: n.attendees, date: n.date, mode: 'equal' })
              }
            >
              Equal chances
            </button>
            <button
              disabled={!!winner || busy}
              className={n.mode === 'performance' ? 'selected' : ''}
              onClick={() =>
                action('/night/settings', {
                  attendees: n.attendees,
                  date: n.date,
                  mode: 'performance',
                })
              }
            >
              Taste-weighted
            </button>
          </div>
          <div className="wheel-container">
            <div className="wheel-pointer" />
            <div
              className="wheel"
              style={{
                background: `conic-gradient(${stops || '#d5ec97 0% 100%'})`,
                transform: `rotate(${rotation}deg)`,
              }}
            >
              {s.weights.map((w, i) => {
                const angle =
                  (s.weights.slice(0, i).reduce((sum, a) => sum + a.chance, 0) + w.chance / 2) *
                  3.6;
                return (
                  <div
                    className="wheel-name"
                    key={w.id}
                    style={{ transform: `rotate(${angle}deg) translateY(-96px) rotate(90deg)` }}
                  >
                    {s.members.find((m) => m.id === w.id)?.username}
                  </div>
                );
              })}
              <div className="wheel-hub">✳</div>
            </div>
          </div>
          <div className="wheel-result" aria-live="polite">
            {spinning ? (
              'A little suspense…'
            ) : winner && reveal ? (
              <>
                <span className="eyebrow">THE PICK IS YOURS</span>
                <h3>
                  {winner.username}
                  <span>✳</span>
                </h3>
              </>
            ) : (
              <p>One spin. One picker. A good night ahead.</p>
            )}
          </div>
          <button
            className="button lime full"
            disabled={!!winner || spinning || busy || !selectedMembers.length}
            onClick={spin}
          >
            <Disc3 size={18} />
            {spinning
              ? 'Spinning…'
              : winner
                ? 'Tonight’s picker is locked in'
                : 'Spin for tonight’s picker'}
          </button>
          <p className="wheel-note">
            {n.mode === 'equal'
              ? 'Everyone attending gets an equal chance.'
              : 'Past picks adjust your chances: each point above or below 3/5 changes your weight by 25%. New pickers start neutral.'}
          </p>
          <div className="odds-row">
            {s.weights.map((w, i) => (
              <span key={w.id}>
                <i
                  style={{
                    background: colors[s.members.findIndex((m) => m.id === w.id) % colors.length],
                  }}
                />
                {s.members.find((m) => m.id === w.id)?.username} <b>{w.chance.toFixed(1)}%</b>
              </span>
            ))}
          </div>
        </section>
        <div className="night-details">
          <section className="panel attendance-panel">
            <span className="eyebrow">THE WHEN & THE WHO</span>
            <label className="night-date">
              Movie night
              <input
                type="date"
                aria-label="Movie night date"
                value={n.date}
                disabled={!!winner || busy}
                onChange={(e) =>
                  e.target.value &&
                  action('/night/settings', {
                    attendees: n.attendees,
                    mode: n.mode,
                    date: e.target.value,
                  })
                }
              />
            </label>
            {s.members.map((m, i) => (
              <div className="attendance-row" key={m.id}>
                <Avatar member={m} index={i} />
                <span>
                  {m.username}
                  {m.id === s.user.id && <small>That’s you</small>}
                </span>
                <button
                  role="switch"
                  aria-checked={n.attendees.includes(m.id)}
                  aria-label={`${m.username} attending`}
                  disabled={
                    !!winner || busy || (n.attendees.length === 1 && n.attendees.includes(m.id))
                  }
                  className={`toggle ${n.attendees.includes(m.id) ? 'on' : ''}`}
                  onClick={() =>
                    action('/night/settings', {
                      attendees: n.attendees.includes(m.id)
                        ? n.attendees.filter((id) => id !== m.id)
                        : [...n.attendees, m.id],
                      mode: n.mode,
                      date: n.date,
                    })
                  }
                >
                  <span />
                </button>
              </div>
            ))}
            {winner && <p className="tiny-note">Lineup locked when the wheel was spun.</p>}
          </section>
          <section className="panel selected-movie">
            <span className="eyebrow">ON THE BIG (OR LITTLE) SCREEN</span>
            {movie ? (
              <>
                <div className="picked-movie">
                  <Poster movie={movie} />
                  <div>
                    <span className="subtle-tag">
                      {n.status === 'watching' ? 'NOW WATCHING' : 'TONIGHT’S MOVIE'}
                    </span>
                    <h3>{movie.title}</h3>
                    <p>
                      {movie.year} · {movie.runtime} min
                    </p>
                  </div>
                </div>
                {n.status === 'planning' ? (
                  <>
                    <button
                      className="button lime full"
                      disabled={busy}
                      onClick={() => action('/night/start', {}, 'Phones down. Enjoy the movie!')}
                    >
                      <Play size={17} />
                      We’re pressing play
                    </button>
                    {n.attendees.includes(s.user.id) && (
                      <button
                        className="veto-button"
                        onClick={() =>
                          action(
                            '/night/veto',
                            {},
                            'Saved to your seen history. Time for another pick.'
                          )
                        }
                      >
                        Wait, I’ve seen this
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    className="button lime full"
                    disabled={busy}
                    onClick={async () => {
                      const result = await action(
                        '/night/finish',
                        {},
                        'A new Friday in the books. Marked seen for all attendees.'
                      );
                      if (result) onRate({ ...n, status: 'completed' });
                    }}
                  >
                    <CheckCheck size={18} />
                    We finished. Let’s rate it.
                  </button>
                )}
              </>
            ) : (
              <div className="no-selection">
                <Film size={30} />
                <h3>{winner ? 'The choice is yours.' : 'Good things are coming.'}</h3>
                <p>
                  {winner
                    ? winner.id === s.user.id
                      ? 'Choose something nobody attending has seen.'
                      : `${winner.username} gets to choose tonight’s movie.`
                    : 'Spin the wheel, then your picker chooses the movie.'}
                </p>
                <button className="button outline full" onClick={onBrowse}>
                  Browse our movies <ArrowUpRight size={16} />
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
const reactionOptions: { id: Reaction; label: string; icon: typeof Heart }[] = [
  { id: 'seen_loved', label: 'Loved it', icon: Heart },
  { id: 'seen_liked', label: 'Liked it', icon: ThumbsUp },
  { id: 'seen_okay', label: 'It was okay', icon: Meh },
  { id: 'seen_bad', label: 'Not good', icon: ThumbsDown },
];
function MovieDetail({
  movie: m,
  s,
  onClose,
  action,
  busy,
}: {
  movie: Movie;
  s: State;
  onClose: () => void;
  action: Action;
  busy: boolean;
}) {
  const [localReaction, setLocalReaction] = useState(m.reaction);
  useEffect(() => setLocalReaction(m.reaction), [m.reaction]);
  return (
    <Modal title="A possibility for Friday" onClose={onClose}>
      <div className="detail-layout">
        <Poster movie={m} large />
        <div>
          <span className="eyebrow">
            {m.year} · ENGLISH{m.runtime ? ` · ${m.runtime} MIN` : ''}
          </span>
          <h2>{m.title}</h2>
          <div className={m.eligible ? 'eligibility good' : 'eligibility'}>
            {m.eligible ? <CheckCheck size={17} /> : <Check size={17} />}{' '}
            {m.eligible
              ? 'Nobody attending has marked this seen'
              : `Seen by ${s.members
                  .filter((member) => m.seenBy.includes(member.id))
                  .map((x) => x.username)
                  .join(', ')}`}
          </div>
          {m.queuedBy.length > 0 && (
            <p className="detail-suggestions">
              On{' '}
              {s.members
                .filter((member) => m.queuedBy.some((q) => q.id === member.id))
                .map((x) => (x.username === s.user.username ? 'your' : `${x.username}’s`))
                .join(' and ')}{' '}
              watchlist.
            </p>
          )}
          <button
            className={`button ${m.queued ? 'outline' : 'lime'} full`}
            disabled={busy}
            onClick={() =>
              action(
                '/preferences',
                { movieId: m.id, queued: !m.queued },
                m.queued ? 'Removed from your watchlist' : 'Added to your watchlist'
              )
            }
          >
            <Bookmark size={17} />
            {m.queued ? 'Saved to my watchlist' : 'Add to my watchlist'}
          </button>
          {m.queued && (
            <button
              className="text-button priority-detail"
              onClick={() =>
                action(
                  '/preferences',
                  { movieId: m.id, priority: !m.priority },
                  m.priority ? 'Priority removed' : 'Moved to the top'
                )
              }
            >
              <ArrowUpRight size={15} />
              {m.priority ? 'At the top of my queue' : 'Move to the top of my queue'}
            </button>
          )}
          <div className="detail-memory">
            <span className="eyebrow">MY MOVIE MEMORY</span>
            <p>
              {m.reaction === 'unseen'
                ? 'Already seen it? Let the group know.'
                : 'Seen history is saved permanently. Update your reaction anytime.'}
            </p>
            <div className="reaction-options">
              {reactionOptions.map((r) => (
                <button
                  key={r.id}
                  className={localReaction === r.id ? 'selected' : ''}
                  disabled={busy}
                  onClick={async () => {
                    const result = await action(
                      '/preferences',
                      { movieId: m.id, reaction: r.id },
                      'Saved to your movie memory'
                    );
                    if (result) setLocalReaction(r.id);
                  }}
                >
                  <r.icon size={18} />
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {s.night.winner_id === s.user.id && s.night.status === 'planning' && m.eligible && (
            <button
              className="button light full"
              disabled={busy}
              onClick={async () => {
                const result = await action(
                  '/night/pick',
                  { movieId: m.id },
                  'Tonight’s movie is set'
                );
                if (result) onClose();
              }}
            >
              <Clapperboard size={17} />
              This is my Friday pick
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
function Review({
  s,
  mode,
  onClose,
  action,
}: {
  s: State;
  mode: 'starter' | 'weekly';
  onClose: () => void;
  action: Action;
}) {
  const [batch] = useState(() => {
    const available = s.movies.filter((m) => m.reaction === 'unseen');
    if (mode === 'starter') available.sort((a, b) => a.catalogIndex - b.catalogIndex);
    const fresh = available.filter((m) => !m.reviewed);
    return [...fresh, ...available.filter((m) => m.reviewed)]
      .slice(0, mode === 'starter' ? 100 : 20)
      .map((m) => m.id);
  });
  const [index, setIndex] = useState(0),
    [seen, setSeen] = useState(false),
    [queued, setQueued] = useState(false),
    [saving, setSaving] = useState(false);
  const startX = useRef<number | null>(null);
  const m = s.movies.find((m) => m.id === batch[index]);
  async function save(reaction: Reaction) {
    if (!m || saving) return;
    setSaving(true);
    const result = await action('/preferences', {
      movieId: m.id,
      reaction,
      ...(queued ? { queued: true, priority: true } : {}),
    });
    if (result) {
      setIndex((i) => i + 1);
      setSeen(false);
      setQueued(false);
    }
    setSaving(false);
  }
  return (
    <Modal
      title={mode === 'starter' ? 'Build your movie memory' : 'The Friday 20'}
      onClose={onClose}
    >
      {m ? (
        <>
          <div className="review-progress">
            <span>
              {String(index + 1).padStart(2, '0')} <span>/ {batch.length}</span>
            </span>
            <span>{mode === 'starter' ? 'THE STARTER LIBRARY' : 'A LITTLE TASTE CHECK'}</span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${(index / batch.length) * 100}%` }} />
          </div>
          <div
            className="review-card"
            onTouchStart={(e) => {
              startX.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              if (startX.current === null) return;
              const dx = e.changedTouches[0].clientX - startX.current;
              startX.current = null;
              if (dx > 70) setSeen(true);
              else if (dx < -70) save('unseen');
            }}
          >
            <Poster movie={m} large />
            <div className="review-title">
              <h2>{m.title}</h2>
              <span>
                {m.year} · {m.runtime} min
              </span>
            </div>
          </div>
          {m.queuedBy.some((q) => q.id !== s.user.id) && (
            <p className="suggested-by">
              <Bookmark size={14} />
              Suggested by{' '}
              {s.members
                .filter(
                  (member) => member.id !== s.user.id && m.queuedBy.some((q) => q.id === member.id)
                )
                .map((m) => m.username)
                .join(', ')}
            </p>
          )}
          {seen ? (
            <>
              <h3 className="review-prompt">Seen it. How was it?</h3>
              <div className="reaction-options">
                {reactionOptions.map((r) => (
                  <button disabled={saving} key={r.id} onClick={() => save(r.id)}>
                    <r.icon size={20} />
                    {r.label}
                  </button>
                ))}
              </div>
              <button className="text-button centered" onClick={() => setSeen(false)}>
                <ArrowLeft size={15} />
                Back
              </button>
            </>
          ) : (
            <>
              <label className="queue-checkbox">
                <input
                  type="checkbox"
                  checked={queued}
                  onChange={(e) => setQueued(e.target.checked)}
                />
                <span>Move this to the top of my watchlist</span>
                <ArrowUpRight size={16} />
              </label>
              <div className="review-actions">
                <button className="button outline" disabled={saving} onClick={() => save('unseen')}>
                  <ArrowLeft size={17} />
                  Haven’t seen it
                </button>
                <button className="button lime" disabled={saving} onClick={() => setSeen(true)}>
                  Seen it
                  <ArrowRight size={17} />
                </button>
              </div>
              <div className="tiny-note">Swipe left for unseen. Right for seen.</div>
            </>
          )}
        </>
      ) : (
        <div className="review-complete">
          <span className="complete-star">✳</span>
          <h2>{batch.length ? 'That’s a wrap.' : 'All caught up.'}</h2>
          <p>
            {batch.length
              ? `${batch.length} movies. A little more you in the next pick.`
              : 'Your movie memory is up to date. Add more titles in group settings.'}
          </p>
          <button className="button lime full" onClick={onClose}>
            Back to the club <ArrowRight size={17} />
          </button>
        </div>
      )}
    </Modal>
  );
}
function HistoryCard({ night: n, s, onRate }: { night: Night; s: State; onRate: () => void }) {
  const m = s.movies.find((m) => m.id === n.movie_id);
  const average = n.ratings.length
    ? n.ratings.reduce((a, r) => a + r.score, 0) / n.ratings.length
    : 0;
  return (
    <article className="history-card">
      {m && (
        <div className="history-poster">
          <Poster movie={m} />
        </div>
      )}
      <div className="history-info">
        <span className="eyebrow">
          {formatDate(n.date)} · PICKED BY {s.members.find((m) => m.id === n.winner_id)?.username}
        </span>
        <h2>{m?.title}</h2>
        <div className="history-ratings">
          {s.members
            .filter((m) => n.attendees.includes(m.id))
            .map((m, i) => {
              const r = n.ratings.find((r) => r.user_id === m.id);
              return (
                <span key={m.id}>
                  <Avatar member={m} index={i} small />
                  {m.username}{' '}
                  <b>
                    {r ? (
                      <>
                        <Star size={12} fill="currentColor" />
                        {r.score}
                      </>
                    ) : (
                      '—'
                    )}
                  </b>
                </span>
              );
            })}
        </div>
        {n.attendees.includes(s.user.id) && (
          <button className="text-button" onClick={onRate}>
            {n.ratings.some((r) => r.user_id === s.user.id)
              ? 'My rating & comparison'
              : 'Rate this Friday'}
            <ArrowUpRight size={15} />
          </button>
        )}
      </div>
      <div className="night-average">
        <Star size={20} />
        <strong>{average ? average.toFixed(1) : '—'}</strong>
        <span>OUR RATING</span>
      </div>
    </article>
  );
}
function RateModal({
  night: n,
  s,
  onClose,
  action,
}: {
  night: Night;
  s: State;
  onClose: () => void;
  action: Action;
}) {
  const existing = n.ratings.find((r) => r.user_id === s.user.id);
  const [score, setScore] = useState(existing?.score || 0),
    [comparisonId, setComparisonId] = useState(existing?.comparison_id || ''),
    [comparison, setComparison] = useState(existing?.comparison || 'same'),
    [saving, setSaving] = useState(false);
  const m = s.movies.find((m) => m.id === n.movie_id);
  const previous = s.nights.filter((p) => p.status === 'completed' && p.id < n.id);
  return (
    <Modal title="The credits have rolled" onClose={onClose}>
      <div className="rating-modal">
        <span className="rating-spark">✳</span>
        <h2>How was our Friday?</h2>
        <p>{m?.title}</p>
        <div className="star-rating" aria-label="Movie rating">
          {[1, 2, 3, 4, 5].map((i) => (
            <button
              key={i}
              aria-label={`Rate ${i} out of 5`}
              aria-pressed={score === i}
              onClick={() => setScore(i)}
            >
              <Star size={34} fill={score >= i ? 'currentColor' : 'none'} />
            </button>
          ))}
        </div>
        <div className="rating-word">
          {
            [
              'Your honest opinion.',
              'Not for me.',
              'Could’ve been better.',
              'A perfectly okay Friday.',
              'Now that’s a good movie.',
              'An all-time Friday.',
            ][score]
          }
        </div>
        {previous.length > 0 && (
          <div className="comparison">
            <label>
              How does it compare?
              <select value={comparisonId} onChange={(e) => setComparisonId(e.target.value)}>
                <option value="">Choose a previous Friday (optional)</option>
                {previous.map((p) => (
                  <option key={p.id} value={p.id}>
                    {s.movies.find((m) => m.id === p.movie_id)?.title}
                  </option>
                ))}
              </select>
            </label>
            {comparisonId && (
              <div className="segmented">
                {[
                  ['worse', 'Not as good'],
                  ['same', 'About the same'],
                  ['better', 'Even better'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={comparison === id ? 'selected' : ''}
                    onClick={() => setComparison(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          className="button lime full"
          disabled={!score || saving}
          onClick={async () => {
            setSaving(true);
            const result = await action(
              '/ratings',
              {
                nightId: n.id,
                score,
                comparisonId: comparisonId ? Number(comparisonId) : null,
                comparison,
              },
              'Your Friday review is saved'
            );
            setSaving(false);
            if (result) onClose();
          }}
        >
          Save my Friday review <ArrowRight size={17} />
        </button>
        <div className="tiny-note">A little feedback makes the next Friday better.</div>
      </div>
    </Modal>
  );
}
// RFC 4180 CSV parsing, including quoted commas and escaped quotes.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('This CSV has an unfinished quoted field.');
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = (rows.shift() || []).map((h) => h.trim().replace(/^\uFEFF/, ''));
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] || ''])));
}
function SettingsModal({
  s,
  onClose,
  action,
  onLogout,
}: {
  s: State;
  onClose: () => void;
  action: Action;
  onLogout: () => void;
}) {
  const [copied, setCopied] = useState(false),
    [confirm, setConfirm] = useState(false),
    [importing, setImporting] = useState(false),
    [error, setError] = useState(''),
    [imported, setImported] = useState('');
  return (
    <Modal title="Your people. Your little club." onClose={onClose}>
      <div className="settings-content">
        <h2>{s.group.name}</h2>
        {s.group.demo ? (
          <div className="info-box">
            This is an isolated demo with fictional friends and sample ratings. Sign out to create
            your real club.
          </div>
        ) : (
          <>
            <p>Share this code privately. Your friends enter it when creating their accounts.</p>
            <button
              className="invite-code"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(s.group.invite);
                  setCopied(true);
                } catch {
                  setError('Copy the invite code manually from the box.');
                }
              }}
            >
              <span>{s.group.invite}</span>
              {copied ? <Check size={20} /> : <Copy size={20} />}
            </button>
          </>
        )}
        <div className="settings-members">
          {s.members.map((m, i) => (
            <span key={m.id}>
              <Avatar member={m} index={i} small />
              {m.username}
            </span>
          ))}
        </div>
        <hr />
        <h3>Your movie library</h3>
        <p>
          {s.movies.length} English-language titles ·{' '}
          {s.movies.filter((m) => m.source === 'imdb-import').length} imported from IMDb
        </p>
        <div className="info-box">
          The starter library is a curated collection, not IMDb’s current top 100. Export an IMDb
          list as CSV and import up to 100 titles here. Existing seen history stays saved.
        </div>
        <p className="csv-help">
          Required columns: <b>Const</b> (IMDb ID), <b>Title</b>, <b>Year</b>. Optional: Genres,
          Runtime (mins). Import order is preserved for new catalog entries.
        </p>
        <label className="queue-checkbox">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          I’ve filtered this list to English-language movies.
        </label>
        <label className={`button outline full import-button ${!confirm ? 'disabled' : ''}`}>
          <Upload size={17} />
          {importing ? 'Importing…' : 'Import IMDb CSV'}
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={!confirm || importing}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setError('');
              setImporting(true);
              try {
                if (file.size > 800000) throw new Error('Please use a CSV smaller than 800 KB.');
                const rows = parseCsv(await file.text());
                if (rows.length > 100)
                  throw new Error('Please limit your IMDb list to 100 titles before importing.');
                const movies = rows.map((r) => ({
                  id: (r.Const || r.const || '').trim(),
                  title: r.Title || r.title || '',
                  year: Number(r.Year || r.year),
                  genres: (r.Genres || '')
                    .split(',')
                    .map((g) => g.trim())
                    .filter(Boolean),
                  runtime: Number(r['Runtime (mins)'] || 0),
                }));
                const result = await action('/catalog/import', {
                  movies,
                  englishOnlyConfirmed: true,
                });
                if (result)
                  setImported(`${result.count} titles imported. Your movie memory is unchanged.`);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setImporting(false);
              }
            }}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {imported && (
          <p className="import-success" role="status">
            {imported}
          </p>
        )}
        <hr />
        <p className="settings-footnote">
          Unanswered means unseen. Seen history is permanent. Your club’s data is stored in this
          app’s database. Keep a database backup before moving or resetting the server.
        </p>
        <button className="button outline full" onClick={onLogout}>
          <LogOut size={17} />
          Sign out
        </button>
      </div>
    </Modal>
  );
}
