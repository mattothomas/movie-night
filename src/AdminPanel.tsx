import { useEffect, useState } from 'react';
import { Settings, Disc3, RotateCcw, Plus, Save, Search, FlaskConical } from 'lucide-react';
import type { State, Night } from './types';
type Action = (path: string, body?: unknown, message?: string) => Promise<any>;
export function AdminPanel({ s, action }: { s: State; action: Action }) {
  const [control, setControl] = useState<{
      override: { enabled: number; winner_id: number | null };
      cachedMovies: number;
    } | null>(null),
    [error, setError] = useState(''),
    [working, setWorking] = useState(false);
  const [target, setTarget] = useState(s.members[0]?.id || 0),
    [editing, setEditing] = useState<number | null>(null),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [movieId, setMovieId] = useState(''),
    [picker, setPicker] = useState(s.members[0]?.id || 0),
    [attendees, setAttendees] = useState(s.members.map((m) => m.id)),
    [scores, setScores] = useState<Record<number, number>>({}),
    [query, setQuery] = useState('');
  async function load() {
    try {
      const r = await fetch('/api/admin');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setControl(d);
      if (d.override.winner_id) setTarget(d.override.winner_id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [s.group.id]);
  function edit(n: Night) {
    setEditing(n.id);
    setDate(n.date);
    setMovieId(n.movie_id || '');
    setPicker(n.winner_id || s.members[0].id);
    setAttendees(n.attendees);
    setScores(Object.fromEntries(n.ratings.map((r) => [r.user_id, r.score])));
    setQuery('');
  }
  function clear() {
    setEditing(null);
    setMovieId('');
    setScores({});
    setQuery('');
    setAttendees(s.members.map((m) => m.id));
  }
  async function perform(path: string, body: unknown, message: string) {
    setWorking(true);
    const r = await action(path, body, message);
    await load();
    setWorking(false);
    return r;
  }
  const past = s.nights.filter((n) => n.status === 'completed');
  const filtered = s.movies.filter(
    (m) => m.id === movieId || m.title.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {s.user.role === 'tester'
              ? 'AN ISOLATED PLACE TO TRY THINGS'
              : 'MATTHEW’S HOST CONTROLS'}
          </div>
          <h1>{s.user.role === 'tester' ? 'The test screening room.' : 'The admin board.'}</h1>
          <p>
            {s.user.role === 'tester'
              ? 'Changes here affect only your test group.'
              : 'Manage past Fridays and the next picker.'}
          </p>
        </div>
        <Settings size={25} />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {s.user.role === 'tester' && (
        <section className="panel admin-switch">
          <FlaskConical size={21} />
          <div>
            <b>Play as someone in this test group</b>
            <p>Use this to try everyone’s swipes, turns, and ratings.</p>
          </div>
          {s.members.map((m) => (
            <button
              className={`button ${m.id === s.user.id ? 'lime' : 'outline'}`}
              key={m.id}
              disabled={working || m.id === s.user.id}
              onClick={() =>
                perform('/admin/test/switch', { userId: m.id }, `Testing as ${m.username}`)
              }
            >
              {m.username}
            </button>
          ))}
        </section>
      )}
      <div className="admin-grid">
        <section className="panel admin-card">
          <span className="eyebrow">NEXT SPIN ONLY</span>
          <h2>
            <Disc3 size={22} />
            Lock the next picker
          </h2>
          <p>
            Choose someone and enable the override. It is consumed by one spin, then turns off. The
            result is marked host-selected.
          </p>
          <label>
            Next picker
            <select
              aria-label="Next picker"
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            >
              {s.members.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.username}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-actions">
            <button
              className="button lime"
              disabled={working}
              onClick={() =>
                perform(
                  '/admin/wheel',
                  { enabled: true, winnerId: target },
                  'Next spin locked to your selected picker'
                )
              }
            >
              Enable next-spin lock
            </button>
            <button
              className="button outline"
              disabled={working || !control?.override.enabled}
              onClick={() =>
                perform('/admin/wheel', { enabled: false }, 'Wheel override turned off')
              }
            >
              Turn off
            </button>
          </div>
          <div className="admin-status" role="status">
            {control?.override.enabled
              ? `ON · next spin goes to ${s.members.find((m) => m.id === control.override.winner_id)?.username}`
              : 'OFF · normal wheel selection'}
          </div>
        </section>
        <section className="panel admin-card">
          <span className="eyebrow">A FRESH START FOR PRACTICE PICKS</span>
          <h2>
            <RotateCcw size={21} />
            Reset current picks
          </h2>
          <p>
            Clear unfinished nights’ picker, selected movie, and wheel draw in this group. Completed
            nights, seen history, reactions, and watchlists stay saved.
          </p>
          <p>A database backup is created before the reset.</p>
          <button
            className="button outline full"
            disabled={working}
            onClick={() =>
              perform(
                '/admin/reset-picks',
                {},
                'Unfinished picks reset. Your movie memory is preserved.'
              )
            }
          >
            <RotateCcw size={16} />
            Reset this group’s current picks
          </button>
          <div className="admin-status">
            {control?.cachedMovies ?? s.movies.length} cached movies · live catalog search remains
            available
          </div>
        </section>
      </div>
      <section className="panel admin-card admin-history">
        <div className="section-heading">
          <div>
            <span className="eyebrow">FILL IN THE FRIDAYS BEFORE THE APP</span>
            <h2>{editing ? 'Edit a past night' : 'Add a past movie night'}</h2>
          </div>
          {editing && (
            <button className="text-button" onClick={clear}>
              <Plus size={16} />
              New entry
            </button>
          )}
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await perform(
              '/admin/nights/save',
              {
                nightId: editing,
                date,
                movieId,
                pickerId: picker,
                attendees,
                scores: attendees
                  .filter((id) => scores[id] > 0)
                  .map((userId) => ({ userId, score: scores[userId] })),
              },
              editing ? 'Past night updated' : 'Past night added'
            );
            if (result) clear();
          }}
        >
          <div className="admin-form-grid">
            <label>
              Date
              <input
                aria-label="Past night date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              Who picked?
              <select
                aria-label="Past night picker"
                value={picker}
                onChange={(e) => setPicker(Number(e.target.value))}
              >
                {s.members
                  .filter((m) => attendees.includes(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.username}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label>
            Find the movie
            <div className="admin-movie-search">
              <input
                aria-label="Find past movie"
                placeholder="Search saved movies or TMDB…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="button"
                className="button outline"
                disabled={!s.catalog.configured || query.trim().length < 2 || working}
                onClick={async () => {
                  setWorking(true);
                  const result = await action('/catalog/search', { query: query.trim(), page: 1 });
                  if (result?.ids.length) setMovieId(result.ids[0]);
                  setWorking(false);
                }}
              >
                <Search size={16} />
                Search TMDB
              </button>
            </div>
            <select
              aria-label="Past night movie"
              required
              value={movieId}
              onChange={(e) => setMovieId(e.target.value)}
            >
              <option value="">Choose a movie</option>
              {filtered.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} ({m.year})
                </option>
              ))}
            </select>
          </label>
          <div className="admin-attendees">
            <span className="eyebrow">WHO WATCHED & HOW WAS IT?</span>
            {s.members.map((m) => (
              <div key={m.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={attendees.includes(m.id)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...attendees, m.id]
                        : attendees.filter((id) => id !== m.id);
                      setAttendees(next);
                      if (!next.includes(picker) && next.length) setPicker(next[0]);
                    }}
                  />
                  {m.username}
                </label>
                <select
                  aria-label={`${m.username} past rating`}
                  disabled={!attendees.includes(m.id)}
                  value={scores[m.id] || 0}
                  onChange={(e) => setScores((old) => ({ ...old, [m.id]: Number(e.target.value) }))}
                >
                  <option value={0}>Let them rate it later</option>
                  {[1, 2, 3, 4, 5].map((score) => (
                    <option key={score} value={score}>
                      {score} / 5
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <button className="button lime" disabled={working || !movieId || !attendees.length}>
            <Save size={17} />
            {editing ? 'Save changes' : 'Add past night'}
          </button>
          <p className="tiny-note">
            Attendees are marked seen. Missing ratings appear as a personal reminder. Editing a
            night never erases permanent seen history.
          </p>
        </form>
      </section>
      <div className="admin-past-list">
        {past.map((n) => (
          <article key={n.id}>
            <span>{n.date}</span>
            <b>{s.movies.find((m) => m.id === n.movie_id)?.title || 'Movie'}</b>
            <button className="text-button" onClick={() => edit(n)}>
              Edit night
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
