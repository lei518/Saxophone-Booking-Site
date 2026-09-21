import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { todayKey } from '../lib/timezone';
import { formatRange, findClash, rangeProblem, isValidTime, DEFAULT_BUFFER_MINUTES } from '../lib/slots';
import { videoEmbed, videoLines, venueLines, cleanTestimonials, parsePhotoDataUrl } from '../lib/media';

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["S","M","T","W","T","F","S"];

function fmtKey(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// ---------------------------------------------------------------------------
// Runs on the server for every visit. Facebook, Messenger and Google don't run
// JavaScript when they look at a link, so the title, description and photo
// for share previews have to be in the page before it reaches them.
// ---------------------------------------------------------------------------
export async function getServerSideProps({ req }) {
  const crypto = await import('crypto');
  const { getSupabase } = await import('../lib/supabaseAdmin');

  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  const siteUrl = (process.env.SITE_URL || `${proto}://${req.headers.host}`).replace(/\/$/, '');

  let profile = null;
  try {
    const { data } = await getSupabase().from('profile').select('*').eq('id', 1).maybeSingle();
    if (data) {
      // Swap the stored photo for a link to it: lighter page, and a real
      // image address that share previews can use.
      // Only link to the photo if the photo route can actually serve it;
      // otherwise leave it out rather than show a broken image.
      const photo = parsePhotoDataUrl(data.photo)
        ? `/api/photo?v=${crypto.createHash('sha1').update(data.photo).digest('hex').slice(0, 10)}`
        : '';
      profile = { ...data, photo };
    }
  } catch {
    // Database unreachable (or paused) - the page falls back to loading the
    // profile in the browser, and shows a message if that fails too.
  }
  return { props: { initialProfile: profile, siteUrl } };
}

export default function Home({ initialProfile, siteUrl }){
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [loadFailed, setLoadFailed] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false); // hide the photo rather than show it broken
  const [manualDates, setManualDates] = useState({});
  const [busyDays, setBusyDays] = useState([]);
  const [ranges, setRanges] = useState({});
  const [bufferMinutes, setBufferMinutes] = useState(DEFAULT_BUFFER_MINUTES);
  const [currentMonth, setCurrentMonth] = useState(()=>{ const d = new Date(); d.setDate(1); return d; });
  const [today, setToday] = useState(null);

  const [bookingDate, setBookingDate] = useState(null);
  const emptyForm = {name:'',email:'',phone:'',type:'Wedding',message:'',start_time:'18:00',end_time:'21:00',website:''};
  const [bookForm, setBookForm] = useState(emptyForm);
  const [bookMsg, setBookMsg] = useState('');
  const [sending, setSending] = useState(false);

  const openedAt = useRef(0);     // when the form was opened, for the bot check
  const triggerRef = useRef(null); // the day button that opened the form
  const modalRef = useRef(null);

  useEffect(()=>{
    // Old bookmarks to /#admin still work - they land on the admin page.
    if(window.location.hash === '#admin'){ router.replace('/admin'); return; }

    // "Today" is the site's timezone, not the visitor's device.
    setToday(new Date(todayKey() + 'T00:00:00'));
    if(!initialProfile) loadProfile();
    loadDates();
  }, []);

  async function loadProfile(){
    try{
      const res = await fetch('/api/profile');
      if(!res.ok) throw new Error();
      setProfile(await res.json());
    } catch {
      setLoadFailed(true);
    }
  }

  async function loadDates(){
    try{
      const res = await fetch('/api/dates');
      const data = await res.json();
      setManualDates(data.manual || {});
      setBusyDays(data.busyDays || []);
      setRanges(data.ranges || {});
      if(data.bufferMinutes != null) setBufferMinutes(data.bufferMinutes);
    } catch {}
  }

  // ----- booking form: open, close, keyboard handling -----

  function openBookingModal(key, e){
    triggerRef.current = e && e.currentTarget;
    openedAt.current = Date.now();
    setBookingDate(key);
    setBookForm({...emptyForm});
    setBookMsg('');
  }

  function closeBookingModal(){
    setBookingDate(null);
    // Put keyboard focus back on the day they came from.
    setTimeout(()=> triggerRef.current && triggerRef.current.focus(), 0);
  }

  useEffect(()=>{
    if(!bookingDate) return;
    const modal = modalRef.current;
    const first = modal && modal.querySelector('input:not([tabindex="-1"]), select, textarea');
    if(first) first.focus();

    function onKey(e){
      if(e.key === 'Escape'){ closeBookingModal(); return; }
      // Keep Tab moving within the form while it's open.
      if(e.key === 'Tab' && modal){
        const items = [...modal.querySelectorAll('a[href], button:not([disabled]), input:not([tabindex="-1"]), select, textarea')];
        if(!items.length) return;
        const firstItem = items[0], lastItem = items[items.length - 1];
        if(e.shiftKey && document.activeElement === firstItem){ e.preventDefault(); lastItem.focus(); }
        else if(!e.shiftKey && document.activeElement === lastItem){ e.preventDefault(); firstItem.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return ()=>{ document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [bookingDate]);

  // ----- availability -----

  // A day is fully unavailable, partly booked, or wide open. Partly booked
  // days are still bookable - he can play two gigs a day at different times.
  function statusFor(key){
    if(manualDates[key]) return 'blocked';
    if(busyDays.includes(key)) return 'blocked';
    if((ranges[key] || []).length > 0) return 'partial';
    return 'open';
  }

  function slotsFor(key){
    return ranges[key] || [];
  }

  // Warns the client before they submit, so they aren't bounced by the server.
  function clashMessage(){
    if(!bookingDate) return null;
    const range = { start: bookForm.start_time, end: bookForm.end_time };
    if(!isValidTime(range.start) || !isValidTime(range.end)) return null;
    const problem = rangeProblem(range);
    if(problem) return problem;
    const clash = findClash(range, bookingDate, ranges, bufferMinutes);
    if(clash) return `That overlaps a gig already booked (${formatRange(clash)}). Allow ${bufferMinutes} minutes either side for pack-up and travel.`;
    return null;
  }

  async function submitBooking(e){
    e.preventDefault();
    setSending(true);
    try{
      const res = await fetch('/api/requests', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ date: bookingDate, ...bookForm, elapsed_ms: Date.now() - openedAt.current })
      });
      if(res.ok){
        setBookMsg(`Request sent. Expect a call at ${bookForm.phone} to talk it through.`);
        loadDates();
        setTimeout(closeBookingModal, 3200);
      } else {
        const data = await res.json().catch(()=>({}));
        setBookMsg(data.error || "Something went wrong. Try again.");
      }
    } catch {
      setBookMsg("Couldn’t reach the site. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  // ----- share preview details (rendered on the server) -----
  const title = profile ? `${profile.name}, live saxophone` : 'Live saxophone';
  const description = (profile && profile.tagline) || 'Check open dates and request a booking.';
  const imageUrl = profile && profile.photo && profile.photo.startsWith('/') ? siteUrl + profile.photo : null;

  const head = (
    <Head>
      <title>{profile ? `Book ${profile.name}` : 'Book live saxophone'}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="description" content={description} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={siteUrl + '/'} />
      {imageUrl && <meta property="og:image" content={imageUrl} />}
      {imageUrl && <meta property="og:image:alt" content={profile.name} />}
      <meta name="twitter:card" content="summary" />
    </Head>
  );

  if(!profile){
    return (
      <>
        {head}
        {loadFailed && (
          <main className="wrap load-failed">
            <h1>This page couldn’t load</h1>
            <p>Please try again in a minute.</p>
          </main>
        )}
      </>
    );
  }

  const firstName = (profile.name || '').trim().split(/\s+/)[0] || 'the musician';
  const videos = videoLines(profile.videos).map(videoEmbed).filter(Boolean);
  const venues = venueLines(profile.venues);
  const quotes = cleanTestimonials(profile.testimonials);

  return (
    <>
      {head}

      <div className="hero">
        <svg className="hero-sax" viewBox="0 0 300 340" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M120 20 L150 15 L200 60 L205 180 C205 220 175 250 150 260 C120 272 95 255 92 225 C89 198 108 178 132 178 C150 178 162 190 162 205 C162 216 154 224 144 224" stroke="#dcae4c" strokeWidth="4" fill="none" strokeLinecap="round"/>
          <circle cx="150" cy="90" r="6" stroke="#dcae4c" strokeWidth="3" fill="none"/>
          <circle cx="160" cy="115" r="6" stroke="#dcae4c" strokeWidth="3" fill="none"/>
          <circle cx="168" cy="140" r="6" stroke="#dcae4c" strokeWidth="3" fill="none"/>
          <circle cx="172" cy="167" r="6" stroke="#dcae4c" strokeWidth="3" fill="none"/>
        </svg>
        <div className="wrap hero-inner">
          {profile.photo && !photoFailed && (
            <img className="hero-photo" src={profile.photo} alt={profile.name} width="128" height="128" onError={()=>setPhotoFailed(true)} />
          )}
          <div className="eyebrow">Live saxophone for hire</div>
          <h1>{profile.name}</h1>
          <p className="tagline">{profile.tagline}</p>
          <div className="hero-actions">
            <a href="#calendar" className="btn btn-primary">Check open dates</a>
            {videos.length > 0
              ? <a href="#listen" className="btn btn-ghost">Hear {firstName} play</a>
              : <a href="#about" className="btn btn-ghost">About</a>}
          </div>
        </div>
      </div>

      <div className="wrap">
        <div className="panel about" id="about">
          <h2>A little about the sound</h2>
          <p>{profile.bio}</p>
          <div className="about-meta">
            {profile.email && <div><b>Email:</b> <a href={`mailto:${profile.email}`}>{profile.email}</a></div>}
            {profile.instagram && <div><b>Instagram:</b> {profile.instagram}</div>}
          </div>
        </div>
      </div>

      {videos.length > 0 && (
        <section id="listen" aria-labelledby="listen-title">
          <div className="wrap">
            <div className="section-head">
              <div className="kicker">Listen</div>
              <h2 id="listen-title">Hear the sound</h2>
            </div>
            <div className={'videos' + (videos.length === 1 ? ' videos-one' : '')}>
              {videos.map((v, i) => (
                <div className={'video' + (v.vertical ? ' video-vertical' : '')} key={v.src}>
                  <iframe
                    src={v.src}
                    title={`${profile.name} performing, video ${i + 1}`}
                    loading="lazy"
                    allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {(quotes.length > 0 || venues.length > 0) && (
        <section id="kind-words" aria-labelledby="kind-words-title" className="kind-words">
          <div className="wrap">
            <div className="section-head">
              <div className="kicker">{quotes.length ? 'Kind words' : 'Experience'}</div>
              <h2 id="kind-words-title">{quotes.length ? 'What clients say' : `Where ${firstName} has played`}</h2>
            </div>
            {quotes.length > 0 && (
              <div className="quotes">
                {quotes.map((q, i) => (
                  <figure className="quote" key={i}>
                    <blockquote>{q.quote}</blockquote>
                    {q.who && <figcaption>{q.who}</figcaption>}
                  </figure>
                ))}
              </div>
            )}
            {venues.length > 0 && (
              <div className="venues">
                {quotes.length > 0 && <h3>Played at</h3>}
                <ul>{venues.map(v => <li key={v}>{v}</li>)}</ul>
              </div>
            )}
          </div>
        </section>
      )}

      <section id="calendar" aria-labelledby="calendar-title">
        <div className="wrap">
          <div className="section-head">
            <div className="kicker">Availability</div>
            <h2 id="calendar-title">Open dates</h2>
          </div>
          {today && <Calendar
            today={today}
            currentMonth={currentMonth}
            setCurrentMonth={setCurrentMonth}
            statusFor={statusFor}
            slotsFor={slotsFor}
            onPick={openBookingModal}
          />}
        </div>
      </section>

      <footer>
        <span>{profile.name}</span> · booking site
      </footer>

      {bookingDate && (
        <div className="overlay show" onClick={(e)=>{ if(e.target.classList.contains('overlay')) closeBookingModal(); }}>
          <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="book-title" aria-describedby="book-date">
            <h3 id="book-title">Request this date</h3>
            <div className="sub" id="book-date">{new Date(bookingDate+'T00:00:00').toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>

            {slotsFor(bookingDate).length > 0 && (
              <div className="taken-slots">
                <b>Already booked this day</b>
                <ul>
                  {slotsFor(bookingDate).map((r,idx)=> <li key={idx}>{formatRange(r)}</li>)}
                </ul>
                <span className="small">{firstName} needs {bufferMinutes} minutes between gigs to pack up and travel.</span>
              </div>
            )}

            <form onSubmit={submitBooking}>
              <div className="time-row">
                <div className="field"><label htmlFor="f-start">Start time</label><input id="f-start" type="time" required value={bookForm.start_time} onChange={e=>setBookForm({...bookForm,start_time:e.target.value})}/></div>
                <div className="field"><label htmlFor="f-end">End time</label><input id="f-end" type="time" required value={bookForm.end_time} onChange={e=>setBookForm({...bookForm,end_time:e.target.value})}/></div>
              </div>
              {clashMessage() && <div className="clash-warn" role="alert">{clashMessage()}</div>}
              <div className="field"><label htmlFor="f-name">Your name</label><input id="f-name" required autoComplete="name" value={bookForm.name} onChange={e=>setBookForm({...bookForm,name:e.target.value})}/></div>
              <div className="field"><label htmlFor="f-phone">Phone</label><input id="f-phone" type="tel" required autoComplete="tel" placeholder="0917 123 4567" value={bookForm.phone} onChange={e=>setBookForm({...bookForm,phone:e.target.value})}/></div>
              <div className="field"><label htmlFor="f-email">Email</label><input id="f-email" type="email" required autoComplete="email" value={bookForm.email} onChange={e=>setBookForm({...bookForm,email:e.target.value})}/></div>
              <div className="field">
                <label htmlFor="f-type">Event type</label>
                <select id="f-type" value={bookForm.type} onChange={e=>setBookForm({...bookForm,type:e.target.value})}>
                  <option>Wedding</option><option>Private party</option><option>Corporate event</option><option>Club / bar gig</option><option>Other</option>
                </select>
              </div>
              <div className="field"><label htmlFor="f-msg">Tell me about the event</label><textarea id="f-msg" value={bookForm.message} onChange={e=>setBookForm({...bookForm,message:e.target.value})} placeholder="Venue, style of music, song requests, anything else"/></div>

              {/* Spam trap: hidden from people and screen readers. Bots that
                  fill in every field fill this one too, and get ignored. */}
              <div className="hp" aria-hidden="true">
                <label htmlFor="f-website">Leave this empty</label>
                <input id="f-website" tabIndex={-1} autoComplete="off" value={bookForm.website} onChange={e=>setBookForm({...bookForm,website:e.target.value})}/>
              </div>

              <p className="privacy-note">
                Your name, phone, email and event details are used only to contact you about this booking
                and to keep {firstName}’s schedule. Only {firstName} has access to them, and they’re never
                shared or used for marketing.
                {profile.email && <> To have your details deleted, email <a href={`mailto:${profile.email}`}>{profile.email}</a>.</>}
              </p>
              <div className="modal-actions">
                <button type="button" className="btn btn-close" onClick={closeBookingModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={!!clashMessage() || sending}>{sending ? 'Sending…' : 'Send request'}</button>
              </div>
              {bookMsg && <div className="msg" role="status">{bookMsg}</div>}
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The month grid. Days you can book are real buttons, so they work with a
// keyboard (Tab, Enter) and screen readers announce the date and status.
// ---------------------------------------------------------------------------
function Calendar({ today, currentMonth, setCurrentMonth, statusFor, slotsFor, onPick }){
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const cells = [];
  for(let i=0;i<firstDow;i++) cells.push(null);
  for(let d=1; d<=daysInMonth; d++) cells.push(d);

  const prevDisabled = new Date(year, month, 1) <= new Date(today.getFullYear(), today.getMonth(), 1);

  return (
    <div className="panel cal-panel">
      <div className="cal-head">
        <h3 aria-live="polite">{MONTH_NAMES[month]} {year}</h3>
        <div className="cal-nav">
          <button type="button" disabled={prevDisabled} onClick={()=> setCurrentMonth(new Date(year, month-1, 1))} aria-label="Previous month">&#8592;</button>
          <button type="button" onClick={()=> setCurrentMonth(new Date(year, month+1, 1))} aria-label="Next month">&#8594;</button>
        </div>
      </div>
      <div className="cal-grid" aria-hidden="true">
        {DOW.map((d,i)=> <div className="cal-dow" key={i}>{d}</div>)}
      </div>
      <div className="cal-grid">
        {cells.map((day, i)=>{
          if(day === null) return <div className="cal-day empty" key={i} aria-hidden="true"></div>;
          const d = new Date(year, month, day);
          const key = fmtKey(d);
          const status = statusFor(key);
          const isPast = d < today;
          const slots = slotsFor(key);
          const spoken = d.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });

          if(isPast){
            return <div className={"cal-day past " + status} key={i}><span className="num">{day}</span><span className="sr-only">, {spoken}, past</span></div>;
          }
          if(status === 'blocked'){
            return <div className="cal-day blocked" key={i}><span className="num">{day}</span><span className="tag" aria-hidden="true">Unavailable</span><span className="sr-only">, {spoken}, unavailable</span></div>;
          }
          const label = status === 'partial'
            ? `${spoken}: some times left. Already booked ${slots.map(formatRange).join(' and ')}. Request a time.`
            : `${spoken}: open. Request a time.`;
          return (
            <button type="button" className={"cal-day " + status} key={i} onClick={(e)=>onPick(key, e)} aria-label={label}>
              <span className="num">{day}</span>
              <span className="tag">{status === 'partial' ? 'Some times left' : 'Open'}</span>
            </button>
          );
        })}
      </div>
      <div className="legend">
        <span><i className="leg-open"></i> Open, tap to request</span>
        <span><i className="leg-partial"></i> Partly booked, some times left</span>
        <span><i className="leg-blocked"></i> Unavailable</span>
      </div>
    </div>
  );
}