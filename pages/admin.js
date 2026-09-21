import { useEffect, useState } from 'react';
import Head from 'next/head';
import s from '../styles/Admin.module.css';
import { todayKey } from '../lib/timezone';
import { formatRange, formatTime } from '../lib/slots';
import { videoEmbed, videoLines, MAX_VIDEOS } from '../lib/media';

const TOKEN_KEY = 'sax_admin_token';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW = ['S','M','T','W','T','F','S'];

// The token lives in sessionStorage so a page refresh keeps him logged in,
// but closing the tab logs him out.
function readToken(){ try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } }
function storeToken(t){ try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch {} }

const pad = (n) => String(n).padStart(2, '0');
const keyFor = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

function niceDate(key, opts){
  return new Date(key + 'T00:00:00').toLocaleDateString(undefined, opts);
}

// Shrinks an uploaded photo so it can be stored straight in the profile.
function fileToResizedDataUrl(file, maxSize = 600, quality = 0.85){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize){ height = Math.round(height * (maxSize / width)); width = maxSize; }
        else if (height > maxSize){ width = Math.round(width * (maxSize / height)); height = maxSize; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------

export default function Admin(){
  const [token, setToken] = useState(undefined); // undefined = still checking
  const [notice, setNotice] = useState('');

  useEffect(()=>{ setToken(readToken() || null); }, []);

  function logIn(t){ storeToken(t); setNotice(''); setToken(t); }
  function logOut(message){ storeToken(null); setToken(null); setNotice(message || ''); }

  return (
    <>
      <Head>
        <title>Bookings admin</title>
        <meta name="robots" content="noindex" />
      </Head>
      {token === undefined ? null
        : token ? <Dashboard token={token} onLogOut={logOut} />
        : <Login onLogIn={logIn} notice={notice} />}
    </>
  );
}

// ---------------------------------------------------------------------------

function Login({ onLogIn, notice }){
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  async function submit(e){
    e.preventDefault();
    setWorking(true); setError('');
    try{
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(()=>({}));
      if(res.ok) return onLogIn(data.token);
      setError(res.status === 429 ? 'Too many attempts. Wait a few minutes, then try again.'
        : res.status === 401 ? 'That password is wrong.'
        : data.error || 'Login failed. Check the server is running.');
    } catch {
      setError('Can’t reach the server.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className={s.loginWrap}>
      <form className={s.loginCard} onSubmit={submit}>
        <h1 className={s.loginTitle}>Bookings</h1>
        <p className={s.loginNote}>{notice || 'Log in to answer requests and manage your calendar.'}</p>
        <label className={s.field}>
          <span>Password</span>
          <input type="password" autoFocus autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required />
        </label>
        {error && <p className={s.error} role="alert">{error}</p>}
        <button className={s.primary} type="submit" disabled={working}>{working ? 'Logging in…' : 'Log in'}</button>
        <a className={s.back} href="/">Back to the site</a>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------------------

function Dashboard({ token, onLogOut }){
  const [view, setView] = useState('requests');
  const [requests, setRequests] = useState(null);
  const [cal, setCal] = useState({ manual:{}, busyDays:[], ranges:{} });
  const [profile, setProfile] = useState(null);
  const [toast, setToast] = useState(null);

  async function api(path, opts = {}){
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type':'application/json', Authorization: 'Bearer ' + token },
    });
    if(res.status === 401){
      onLogOut('Your session ended. Log in again.');
      throw new Error('unauthorised');
    }
    return res;
  }

  function flash(text, tone = 'ok', ms = 3200){
    setToast({ text, tone });
    clearTimeout(flash.t);
    flash.t = setTimeout(()=> setToast(null), ms);
  }

  async function loadRequests(){
    const res = await api('/api/requests');
    setRequests(await res.json());
  }
  async function loadDates(){
    const res = await fetch('/api/dates');
    const data = await res.json();
    setCal({ manual: data.manual || {}, busyDays: data.busyDays || [], ranges: data.ranges || {} });
  }
  async function loadProfile(){
    const res = await fetch('/api/profile');
    setProfile(await res.json());
  }

  useEffect(()=>{
    Promise.all([loadRequests(), loadDates(), loadProfile()]).catch(()=>{});
  }, []);

  const pendingCount = (requests || []).filter(r => r.status === 'pending').length;

  const nav = [
    { id:'requests', label:'Requests', count: pendingCount },
    { id:'schedule', label:'Schedule' },
    { id:'profile',  label:'Profile' },
  ];

  return (
    <div className={s.page}>
      <header className={s.bar}>
        <div className={s.brand}>
          {profile ? profile.name : 'Bookings'}
          <small>Bookings admin</small>
        </div>
        <div className={s.barLinks}>
          <a className={s.barLink} href="/" target="_blank" rel="noreferrer">View site</a>
          <button className={s.barLink} onClick={()=>onLogOut('You’ve logged out.')}>Log out</button>
        </div>
      </header>

      <div className={s.layout}>
        <nav className={s.nav} aria-label="Admin sections">
          {nav.map(item => (
            <button
              key={item.id}
              className={s.navItem + ' ' + (view === item.id ? s.navItemActive : '')}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={()=>setView(item.id)}
            >
              {item.label}
              {item.count > 0 && <span className={s.count} aria-label={`${item.count} waiting`}>{item.count}</span>}
            </button>
          ))}
        </nav>

        <main className={s.main}>
          {view === 'requests' && (
            <Requests requests={requests} api={api} flash={flash} reload={()=>Promise.all([loadRequests(), loadDates()])} />
          )}
          {view === 'schedule' && (
            <Schedule cal={cal} requests={requests || []} api={api} flash={flash} reload={loadDates} />
          )}
          {view === 'profile' && profile && (
            <Profile profile={profile} api={api} flash={flash} onSaved={setProfile} />
          )}
        </main>
      </div>

      <div className={s.toast + ' ' + (toast ? s.toastShow : '') + ' ' + (toast && toast.tone === 'error' ? s.toastError : '')} role="status" aria-live="polite">
        {toast && toast.text}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Entry({ r, children }){
  const d = new Date(r.date + 'T00:00:00');
  return (
    <article className={s.entry}>
      <div className={s.margin}>
        <span className={s.dayNum}>{d.getDate()}</span>
        <span className={s.dayMeta}>{d.toLocaleDateString(undefined, { weekday:'short' })}</span>
        <span className={s.dayMeta}>{d.toLocaleDateString(undefined, { month:'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })}</span>
      </div>
      <div>
        {r.start_time && r.end_time && <div className={s.time}>{formatRange({ start:r.start_time, end:r.end_time })}</div>}
        <h3 className={s.who}>{r.name}</h3>
        <p className={s.what}>{r.type}</p>
        <p className={s.contact}>
          {r.phone && <a className={s.phone} href={`tel:${r.phone.replace(/[^\d+]/g,'')}`}>Call {r.phone}</a>}
          <a href={`mailto:${r.email}`}>{r.email}</a>
        </p>
        {r.message && <p className={s.note}>{r.message}</p>}
        {children}
      </div>
    </article>
  );
}

function Requests({ requests, api, flash, reload }){
  const [busyId, setBusyId] = useState(null);
  const [cancelling, setCancelling] = useState(null); // id of the gig whose cancel form is open
  const [reason, setReason] = useState('');
  const [blockDay, setBlockDay] = useState(false);

  function openCancel(r){ setCancelling(r.id); setReason(''); setBlockDay(false); }
  function closeCancel(){ setCancelling(null); }

  async function cancelGig(r){
    setBusyId(r.id);
    try{
      const res = await api('/api/requests', { method:'PATCH', body: JSON.stringify({ id:r.id, status:'cancelled', reason, blockDay }) });
      const data = await res.json().catch(()=>({}));
      if(!res.ok){ flash(data.error || 'That didn’t go through. Try again.', 'error'); return; }

      const cal = data.calendar || {};
      const parts = ['Gig cancelled.'];
      if(cal.removed) parts.push('Removed from your Google Calendar.');
      if(cal.error) parts.push(`It couldn’t be removed from your Google Calendar (${cal.error}), so delete it there by hand.`);
      if(data.blocked) parts.push(`${niceDate(r.date, { weekday:'short', month:'short', day:'numeric' })} is now blocked.`);
      flash(parts.join(' '), cal.error ? 'error' : 'ok', cal.error ? 10000 : 5000);
      setCancelling(null);
      await reload();
    } catch(e){
      if(e.message !== 'unauthorised') flash('Can’t reach the server.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  if(!requests) return <section className={s.sheet}><p className={s.empty}>Loading requests…</p></section>;

  const today = todayKey();
  const byTime = (a, b) => (a.date + (a.start_time || '')).localeCompare(b.date + (b.start_time || ''));
  const pending  = requests.filter(r => r.status === 'pending').sort(byTime);
  const upcoming = requests.filter(r => r.status === 'approved' && r.date >= today).sort(byTime);
  const history  = requests.filter(r => !(r.status === 'pending') && !(r.status === 'approved' && r.date >= today)).sort(byTime).reverse();

  async function decide(r, status){
    if(status === 'declined' && !window.confirm(`Decline ${r.name}'s request? This doesn't contact them, so let them know yourself.`)) return;
    setBusyId(r.id);
    try{
      const res = await api('/api/requests', { method:'PATCH', body: JSON.stringify({ id:r.id, status }) });
      const data = await res.json().catch(()=>({}));
      if(!res.ok){ flash(data.error || 'That didn’t go through. Try again.', 'error'); return; }
      if(status === 'approved'){
        const cal = data.calendar || {};
        const declined = data.autoDeclined || [];
        // The approval itself always went through; these report the side effects.
        const parts = ['Approved.'];
        if(cal.added) parts.push('Added to your Google Calendar.');
        if(cal.error) parts.push(`It wasn’t added to your Google Calendar: ${cal.error}.`);
        if(declined.length) parts.push(`Clashing request${declined.length === 1 ? '' : 's'} declined, so let ${declined.length === 1 ? 'them' : 'these people'} know: ${declined.map(d => d.phone ? `${d.name} (${d.phone})` : d.name).join(', ')}.`);
        flash(parts.join(' '), cal.error ? 'error' : 'ok', cal.error || declined.length ? 12000 : 3600);
      } else {
        flash(`Declined. Remember to let ${r.name} know.`);
      }
      await reload();
    } catch(e){
      if(e.message !== 'unauthorised') flash('Can’t reach the server.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <section className={s.sheet}>
        <h2 className={s.sheetTitle}>Waiting on you</h2>
        <p className={s.sheetNote}>
          {pending.length
            ? 'Call the client to talk it through, then approve or decline. Approving adds the gig to your Google Calendar and declines any request that clashes with it.'
            : 'Nothing to answer. New requests show up here and in your email.'}
        </p>
        {pending.map(r => (
          <Entry r={r} key={r.id}>
            <div className={s.actions}>
              <button className={s.approve} disabled={busyId === r.id} onClick={()=>decide(r, 'approved')}>Approve</button>
              <button className={s.decline} disabled={busyId === r.id} onClick={()=>decide(r, 'declined')}>Decline</button>
            </div>
          </Entry>
        ))}
      </section>

      <section className={s.sheet}>
        <h2 className={s.sheetTitle}>Coming up</h2>
        {upcoming.length === 0
          ? <p className={s.sheetNote}>No confirmed gigs ahead yet.</p>
          : upcoming.map(r => {
              const first = r.name.split(' ')[0];
              const sameDay = upcoming.filter(o => o.date === r.date && o.id !== r.id);
              return (
                <Entry r={r} key={r.id}>
                  {cancelling === r.id ? (
                    <div className={s.cancelBox}>
                      <p className={s.cancelHint}>
                        This doesn’t contact {first}. Call them to let them know, then cancel here
                        to free the time and remove it from your Google Calendar.
                      </p>
                      <label className={s.field}>
                        <span>Reason, for your records (optional)</span>
                        <textarea
                          value={reason}
                          onChange={e=>setReason(e.target.value)}
                          maxLength={1000}
                          placeholder="For example: sick, passed them to Miguel"
                        />
                      </label>
                      {sameDay.length > 0 && (
                        <p className={s.cancelHint}>
                          You have {sameDay.length === 1 ? 'another gig' : `${sameDay.length} other gigs`} that day
                          ({sameDay.map(o => formatRange({ start:o.start_time, end:o.end_time })).join(', ')}).
                          Cancel {sameDay.length === 1 ? 'it' : 'them'} separately if you can’t make {sameDay.length === 1 ? 'it' : 'those'} either.
                        </p>
                      )}
                      <label className={s.check}>
                        <input type="checkbox" checked={blockDay} onChange={e=>setBlockDay(e.target.checked)} />
                        <span>Block the rest of {niceDate(r.date, { weekday:'long', month:'short', day:'numeric' })} so no one else can book it</span>
                      </label>
                      <div className={s.actions}>
                        <button className={s.danger} disabled={busyId === r.id} onClick={()=>cancelGig(r)}>
                          {busyId === r.id ? 'Cancelling…' : 'Cancel gig'}
                        </button>
                        <button className={s.keep} disabled={busyId === r.id} onClick={closeCancel}>Keep gig</button>
                      </div>
                    </div>
                  ) : (
                    <div className={s.actions}>
                      <button className={s.quiet} onClick={()=>openCancel(r)}>Cancel gig…</button>
                    </div>
                  )}
                </Entry>
              );
            })}
      </section>

      {history.length > 0 && (
        <details className={s.sheet + ' ' + s.history}>
          <summary className={s.sheetTitle}>History <span className={s.summaryCount}>{history.length}</span></summary>
          {history.map(r => (
            <Entry r={r} key={r.id}>
              <span className={s.status + ' ' + (r.status === 'approved' ? '' : s.statusDeclined)}>
                {r.status === 'declined' ? 'Declined' : r.status === 'cancelled' ? 'Cancelled by you' : 'Played'}
              </span>
              {r.status === 'cancelled' && r.cancel_reason && <p className={s.note}>{r.cancel_reason}</p>}
            </Entry>
          ))}
        </details>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function Schedule({ cal, requests, api, flash, reload }){
  const today = todayKey();
  const [month, setMonth] = useState(()=>{ const [y, m] = today.split('-').map(Number); return { y, m: m - 1 }; });
  const [working, setWorking] = useState(null);

  const first = new Date(month.y, month.m, 1).getDay();
  const days = new Date(month.y, month.m + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  const shift = (n) => setMonth(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  async function toggle(key){
    const google = cal.busyDays.includes(key) && !cal.manual[key];
    if(google){ flash('That day is busy on your Google Calendar. Change it there.', 'error'); return; }
    setWorking(key);
    try{
      const res = await api('/api/dates', { method:'POST', body: JSON.stringify({ date:key }) });
      if(!res.ok){ flash('Couldn’t change that day.', 'error'); return; }
      await reload();
      flash(`${niceDate(key, { weekday:'short', month:'short', day:'numeric' })} ${cal.manual[key] ? 'is open again' : 'is now blocked'}.`);
    } catch(e){
      if(e.message !== 'unauthorised') flash('Can’t reach the server.', 'error');
    } finally {
      setWorking(null);
    }
  }

  return (
    <section className={s.sheet}>
      <div className={s.calHead}>
        <h2 className={s.sheetTitle}>{MONTHS[month.m]} {month.y}</h2>
        <div className={s.calNav}>
          <button onClick={()=>shift(-1)} aria-label="Previous month">‹</button>
          <button onClick={()=>shift(1)} aria-label="Next month">›</button>
        </div>
      </div>
      <p className={s.sheetNote}>
        Tap a day to block it off completely, for a day of rest or travel. Tap again to open it.
        Your gigs appear here automatically once approved.
      </p>

      <div className={s.grid}>
        {DOW.map((d, i) => <div className={s.dow} key={i}>{d}</div>)}
        {cells.map((day, i) => {
          if(day === null) return <div key={i} aria-hidden="true" />;
          const key = keyFor(month.y, month.m, day);
          const slots = cal.ranges[key] || [];
          const manual = !!cal.manual[key];
          const google = cal.busyDays.includes(key) && !manual;
          const pending = requests.some(r => r.date === key && r.status === 'pending');
          const past = key < today;
          const cls = [s.cell, past && s.cellPast, key === today && s.cellToday, (manual || google) && s.cellBlocked].filter(Boolean).join(' ');
          return (
            <button key={i} className={cls} disabled={past || working === key} onClick={()=>toggle(key)}
              title={slots.map(formatRange).join('\n') || undefined}
              aria-label={`${niceDate(key, { weekday:'long', month:'long', day:'numeric' })}${manual ? ', blocked' : google ? ', busy on Google Calendar' : ''}${slots.length ? `, ${slots.length} gig${slots.length === 1 ? '' : 's'}` : ''}`}>
              <span className={s.cellNum}>{day}</span>
              {manual && <span className={s.cellTag}>Blocked</span>}
              {google && <span className={s.cellTag}>Google</span>}
              {slots.slice(0, 2).map((r, j) => <span className={s.gig} key={j}>{formatTime(r.start)}</span>)}
              {slots.length > 2 && <span className={s.more}>+{slots.length - 2} more</span>}
              {slots.length > 0 && <span className={s.gigCount}>{slots.length}</span>}
              {pending && <span className={s.pendingDot} title="Request waiting" />}
            </button>
          );
        })}
      </div>

      <div className={s.key}>
        <span><i className={s.keyGig} /> Gig</span>
        <span><i className={s.keyBlocked} /> Blocked or busy</span>
        <span><i className={s.keyPending} /> Request waiting</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Profile({ profile, api, flash, onSaved }){
  const [form, setForm] = useState({
    ...profile,
    videos: profile.videos || '',
    venues: profile.venues || '',
    testimonials: Array.isArray(profile.testimonials) ? profile.testimonials : [],
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // Checks each video link as he types, so a bad one is obvious before saving.
  const links = videoLines(form.videos);
  const badLinks = links.filter(l => !videoEmbed(l));
  const tooMany = links.length > MAX_VIDEOS;

  const quotes = form.testimonials;
  const setQuote = (i, key) => (e) => {
    const next = quotes.map((q, j) => j === i ? { ...q, [key]: e.target.value } : q);
    setForm({ ...form, testimonials: next });
  };
  const addQuote = () => setForm({ ...form, testimonials: [...quotes, { quote:'', who:'' }] });
  const removeQuote = (i) => setForm({ ...form, testimonials: quotes.filter((_, j) => j !== i) });

  async function save(e){
    e.preventDefault();
    setSaving(true);
    try{
      const res = await api('/api/profile', { method:'PUT', body: JSON.stringify(form) });
      const data = await res.json().catch(()=>({}));
      if(!res.ok){ flash(data.error || 'Couldn’t save the profile.', 'error'); return; }
      onSaved(form);
      flash('Profile saved.');
    } catch(e){
      if(e.message !== 'unauthorised') flash('Can’t reach the server.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={s.sheet} onSubmit={save}>
      <h2 className={s.sheetTitle}>Profile</h2>
      <p className={s.sheetNote}>What clients see on the booking site.</p>

      <div className={s.form}>
        <div className={s.photoRow}>
          {form.photo ? <img className={s.photo} src={form.photo} alt="" /> : <div className={s.photo + ' ' + s.photoEmpty} />}
          <label className={s.upload}>
            {form.photo ? 'Change photo' : 'Add a photo'}
            <input type="file" accept="image/*" onChange={async (e)=>{
              const file = e.target.files[0];
              if(!file) return;
              setForm({ ...form, photo: await fileToResizedDataUrl(file) });
            }} />
          </label>
        </div>

        <label className={s.field}><span>Name</span><input value={form.name || ''} onChange={set('name')} /></label>
        <label className={s.field}><span>Tagline</span><input value={form.tagline || ''} onChange={set('tagline')} /></label>
        <label className={s.field}><span>Bio</span><textarea value={form.bio || ''} onChange={set('bio')} /></label>
        <div className={s.two}>
          <label className={s.field}><span>Email</span><input type="email" value={form.email || ''} onChange={set('email')} /></label>
          <label className={s.field}><span>Instagram</span><input value={form.instagram || ''} onChange={set('instagram')} /></label>
        </div>

        <h3 className={s.groupTitle}>Show your work</h3>

        <label className={s.field}>
          <span>Performance videos</span>
          <textarea
            className={s.mono}
            value={form.videos}
            onChange={set('videos')}
            placeholder={'https://www.youtube.com/watch?v=…\nhttps://www.facebook.com/…/videos/…'}
          />
          <small className={s.hint}>
            One YouTube or Facebook video link per line, up to {MAX_VIDEOS}. Facebook videos must be public to play on the site.
          </small>
          {links.length > 0 && !badLinks.length && !tooMany && (
            <small className={s.ok}>{links.length} video{links.length === 1 ? '' : 's'} ready to show.</small>
          )}
          {badLinks.length > 0 && (
            <small className={s.bad}>
              Not a YouTube or Facebook video link: {badLinks.map(l => l.length > 50 ? l.slice(0, 50) + '…' : l).join(', ')}
            </small>
          )}
          {tooMany && <small className={s.bad}>That’s {links.length} links. Keep it to {MAX_VIDEOS}.</small>}
        </label>

        <div className={s.field}>
          <span>What clients say</span>
          <small className={s.hint + ' ' + s.hintTop}>Short quotes from past clients, with who said it. Ask them first.</small>
          {quotes.map((q, i) => (
            <div className={s.quoteRow} key={i}>
              <textarea aria-label={`Quote ${i + 1}`} value={q.quote} onChange={setQuote(i, 'quote')} maxLength={400}
                placeholder="He made our first dance unforgettable. Guests are still talking about it." />
              <div className={s.quoteWho}>
                <input aria-label={`Who said quote ${i + 1}`} value={q.who} onChange={setQuote(i, 'who')} maxLength={100}
                  placeholder="Maria & Paolo, wedding" />
                <button type="button" className={s.quiet} onClick={()=>removeQuote(i)}>Remove</button>
              </div>
            </div>
          ))}
          {quotes.length < 6 && (
            <button type="button" className={s.addBtn} onClick={addQuote}>{quotes.length ? 'Add another quote' : 'Add a quote'}</button>
          )}
        </div>

        <label className={s.field}>
          <span>Venues played</span>
          <textarea value={form.venues} onChange={set('venues')} placeholder={'Clark Marriott\nBlackfish\nThe Farm at San Benito'} />
          <small className={s.hint}>One per line. Shown as a list on the site.</small>
        </label>

        <h3 className={s.groupTitle}>Scheduling</h3>
        <label className={s.field}>
          <span>Minutes between gigs</span>
          <input type="number" min="0" max="480" value={form.buffer_minutes ?? 60} onChange={set('buffer_minutes')} className={s.short} />
          <small className={s.hint}>Time to pack up and travel. Clients can’t book a slot that starts sooner than this after another gig ends.</small>
        </label>

        <button className={s.primary} type="submit" disabled={saving || badLinks.length > 0 || tooMany}>{saving ? 'Saving…' : 'Save profile'}</button>
      </div>
    </form>
  );
}