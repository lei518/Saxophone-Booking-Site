import { useEffect, useState } from 'react';
import Head from 'next/head';
import { todayKey } from '../lib/timezone';
import { formatRange, findClash, rangeProblem, isValidTime, DEFAULT_BUFFER_MINUTES } from '../lib/slots';

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["S","M","T","W","T","F","S"];

function fmtKey(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// Resizes an uploaded image down to a reasonable size and returns a base64
// data URL, so a photo can be stored directly in the profile without needing
// separate image hosting.
function fileToResizedDataUrl(file, maxSize = 600, quality = 0.85){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize){ height = Math.round(height * (maxSize/width)); width = maxSize; }
        else if (height > maxSize){ width = Math.round(width * (maxSize/height)); height = maxSize; }
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

export default function Home(){
  const [profile, setProfile] = useState(null);
  const [manualDates, setManualDates] = useState({});
  const [busyDays, setBusyDays] = useState([]);
  const [ranges, setRanges] = useState({});
  const [bufferMinutes, setBufferMinutes] = useState(DEFAULT_BUFFER_MINUTES);
  const [requests, setRequests] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(()=>{ const d = new Date(); d.setDate(1); return d; });
  const [today, setToday] = useState(null);

  const [bookingDate, setBookingDate] = useState(null);
  const emptyForm = {name:'',email:'',phone:'',type:'Wedding',message:'',start_time:'18:00',end_time:'21:00'};
  const [bookForm, setBookForm] = useState(emptyForm);
  const [bookMsg, setBookMsg] = useState('');

  const [showLogin, setShowLogin] = useState(false);
  const [loginPass, setLoginPass] = useState('');
  const [loginMsg, setLoginMsg] = useState('');
  const [adminToken, setAdminToken] = useState(null); // held in memory only while logged in
  const [activeTab, setActiveTab] = useState('requests');
  const [profileForm, setProfileForm] = useState(null);
  const [profileMsg, setProfileMsg] = useState('');

  const [toastMsg, setToastMsg] = useState('');

  useEffect(()=>{
    // "Today" is the site's timezone, not the visitor's device — otherwise a
    // customer abroad sees a different set of past dates than he does.
    setToday(new Date(todayKey() + 'T00:00:00'));
    loadProfile();
    loadDates();
  }, []);

  useEffect(()=>{
    if(adminToken) loadRequests();
  }, [adminToken]);

  // Quiet way into the admin panel: add #admin to the end of the site's URL.
  useEffect(()=>{
    function checkHash(){
      if(window.location.hash === '#admin') setShowLogin(true);
    }
    checkHash();
    window.addEventListener('hashchange', checkHash);
    return ()=> window.removeEventListener('hashchange', checkHash);
  }, []);

  // Every admin request carries the session token in a header, never in the URL.
  function authHeaders(){
    return { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + adminToken };
  }

  function showToast(msg){
    setToastMsg(msg);
    setTimeout(()=> setToastMsg(''), 2600);
  }

  async function loadProfile(){
    const res = await fetch('/api/profile');
    const data = await res.json();
    setProfile(data);
  }

  async function loadDates(){
    const res = await fetch('/api/dates');
    const data = await res.json();
    setManualDates(data.manual || {});
    setBusyDays(data.busyDays || []);
    setRanges(data.ranges || {});
    if(data.bufferMinutes != null) setBufferMinutes(data.bufferMinutes);
  }

  async function loadRequests(){
    const res = await fetch('/api/requests', { headers: authHeaders() });
    if(res.status === 401){ toggleAdmin(false); showToast('Session expired — please log in again.'); return; }
    const data = await res.json();
    setRequests(data);
  }

  // A day is fully unavailable, partly booked, or wide open. Partly booked
  // days are still clickable - he can play two gigs in a day at different times.
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

  function openBookingModal(key){
    setBookingDate(key);
    setBookForm({...emptyForm});
    setBookMsg('');
  }

  async function submitBooking(e){
    e.preventDefault();
    const res = await fetch('/api/requests', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ date: bookingDate, ...bookForm })
    });
    if(res.ok){
      setBookMsg("Request sent — you'll hear back soon.");
      loadDates();
      setTimeout(()=> setBookingDate(null), 1400);
    } else {
      const data = await res.json().catch(()=>({}));
      setBookMsg(data.error || "Something went wrong — try again.");
    }
  }

  async function tryLogin(){
    const res = await fetch('/api/login', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ password: loginPass })
    });
    if(res.ok){
      const { token } = await res.json();
      setAdminToken(token);
      setLoginPass('');
      setShowLogin(false);
      setLoginMsg('');
    } else if(res.status === 429){
      setLoginMsg('Too many attempts. Wait a few minutes.');
    } else {
      setLoginMsg('Wrong password.');
    }
  }

  function toggleAdmin(on){
    if(!on){ setAdminToken(null); }
  }

  async function adminCycleDate(key){
    await fetch('/api/dates', {
      method:'POST',
      headers: authHeaders(),
      body: JSON.stringify({ date:key })
    });
    loadDates();
  }

  async function decide(id, status){
    await fetch('/api/requests', {
      method:'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ id, status })
    });
    loadRequests();
    loadDates();
    showToast(status === 'approved' ? 'Approved — date marked booked.' : 'Request declined.');
  }

  function openProfileTab(){
    setActiveTab('profile');
    setProfileForm({ ...profile });
  }

  async function saveProfile(){
    const res = await fetch('/api/profile', {
      method:'PUT',
      headers: authHeaders(),
      body: JSON.stringify(profileForm)
    });
    if(res.ok){
      setProfile(profileForm);
      setProfileMsg('Saved.');
      setTimeout(()=> setProfileMsg(''), 1800);
    } else {
      setProfileMsg('Could not save.');
    }
  }

  if(!profile || !today) return null;

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const cells = [];
  for(let i=0;i<firstDow;i++) cells.push(null);
  for(let d=1; d<=daysInMonth; d++) cells.push(d);

  const isAdmin = !!adminToken;
  const firstOfThisView = new Date(year, month, 1);
  const firstOfToday = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevDisabled = !isAdmin && firstOfThisView <= firstOfToday;

  return (
    <>
      <Head><title>Book {profile.name}</title></Head>

      <div className="hero">
        <svg className="hero-sax" viewBox="0 0 300 340" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M120 20 L150 15 L200 60 L205 180 C205 220 175 250 150 260 C120 272 95 255 92 225 C89 198 108 178 132 178 C150 178 162 190 162 205 C162 216 154 224 144 224" stroke="#dcae4c" strokeWidth="4" fill="none" strokeLinecap="round"/>
          <circle cx="150" cy="90" r="6" stroke="#dcae4c" strokeWidth="3" fill="none"/>
          <circle cx="160" cy="115" r="6" stroke="#dcae4c" strokeWidth="3" fill="none"/>
          <circle cx="168" cy="140" r="6" stroke="#dcae4c" strokeWidth="3" fill="none"/>
          <circle cx="172" cy="167" r="6" stroke="#dcae4c" strokeWidth="3" fill="none"/>
        </svg>
        <div className="wrap hero-inner">
          {profile.photo && (
            <img className="hero-photo" src={profile.photo} alt={profile.name} />
          )}
          <div className="eyebrow">Live saxophone for hire</div>
          <h1>{profile.name}</h1>
          <p className="tagline">{profile.tagline}</p>
          <div className="hero-actions">
            <a href="#calendar" className="btn btn-primary">Check open dates</a>
            <a href="#about" className="btn btn-ghost">About</a>
          </div>
        </div>
      </div>

      <div className="wrap">
        <div className="panel about" id="about">
          <h2>A little about the sound</h2>
          <p>{profile.bio}</p>
          <div className="about-meta">
            <div><b>Booking:</b> {profile.email}</div>
            <div><b>Instagram:</b> {profile.instagram}</div>
            <div><b>Typical rate:</b> {profile.rate}</div>
          </div>
        </div>
      </div>

      <section id="calendar">
        <div className="wrap">
          <div className="section-head">
            <div className="kicker">Availability</div>
            <h2>Open dates</h2>
          </div>
          <div className="panel cal-panel">
            <div className="cal-head">
              <h3>{MONTH_NAMES[month]} {year}</h3>
              <div className="cal-nav">
                <button disabled={prevDisabled} onClick={()=> setCurrentMonth(new Date(year, month-1, 1))} aria-label="Previous month">&#8592;</button>
                <button onClick={()=> setCurrentMonth(new Date(year, month+1, 1))} aria-label="Next month">&#8594;</button>
              </div>
            </div>
            <div className="cal-grid">
              {DOW.map((d,i)=> <div className="cal-dow" key={i}>{d}</div>)}
            </div>
            <div className="cal-grid">
              {cells.map((day, i)=>{
                if(day === null) return <div className="cal-day empty" key={i}></div>;
                const d = new Date(year, month, day);
                const key = fmtKey(d);
                const status = statusFor(key);
                const isPast = d < today;
                const hasPending = requests.some(r => r.date === key && r.status === 'pending');

                const slots = slotsFor(key);

                if(isAdmin){
                  return (
                    <div className={"cal-day admin-edit " + status} key={i} onClick={()=>adminCycleDate(key)}>
                      <div className="num">{day}</div>
                      <div className="tag">
                        {status === 'blocked' ? 'Blocked' : slots.length ? slots.length + (slots.length === 1 ? ' gig' : ' gigs') : 'Open'}
                      </div>
                      {hasPending && <div className="pending-dot"></div>}
                    </div>
                  );
                }
                if(isPast){
                  return <div className={"cal-day past " + status} key={i}><div className="num">{day}</div></div>;
                }
                if(status === 'blocked'){
                  return <div className="cal-day blocked" key={i}><div className="num">{day}</div><div className="tag">Unavailable</div></div>;
                }
                if(status === 'partial'){
                  return (
                    <div className="cal-day partial" key={i} onClick={()=>openBookingModal(key)} title={slots.map(formatRange).join(', ')}>
                      <div className="num">{day}</div>
                      <div className="tag">Some times left</div>
                      {hasPending && <div className="pending-dot"></div>}
                    </div>
                  );
                }
                return (
                  <div className="cal-day open" key={i} onClick={()=>openBookingModal(key)}>
                    <div className="num">{day}</div>
                    <div className="tag">Open</div>
                    {hasPending && <div className="pending-dot"></div>}
                  </div>
                );
              })}
            </div>
            <div className="legend">
              <span><i className="leg-open"></i> Open — tap to request</span>
              <span><i className="leg-partial"></i> Partly booked — some times left</span>
              <span><i className="leg-blocked"></i> Unavailable</span>
              <span><i className="leg-pending"></i> Pending request</span>
            </div>
          </div>
        </div>
      </section>

      <footer>
        {isAdmin && (
          <div style={{marginBottom:8}}>
            Logged in as admin ·{' '}
            <a href="#" style={{textDecoration:'underline'}} onClick={(e)=>{e.preventDefault(); toggleAdmin(false);}}>log out</a>
          </div>
        )}
        <span>{profile.name}</span> · booking site
      </footer>

      {bookingDate && (
        <div className="overlay show" onClick={(e)=>{ if(e.target.classList.contains('overlay')) setBookingDate(null); }}>
          <div className="modal">
            <h3>Request this date</h3>
            <div className="sub">{new Date(bookingDate+'T00:00:00').toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>

            {slotsFor(bookingDate).length > 0 && (
              <div className="taken-slots">
                <b>Already booked this day</b>
                <ul>
                  {slotsFor(bookingDate).map((r,idx)=> <li key={idx}>{formatRange(r)}</li>)}
                </ul>
                <span className="small">He needs {bufferMinutes} minutes between gigs to pack up and travel.</span>
              </div>
            )}

            <form onSubmit={submitBooking}>
              <div className="time-row">
                <div className="field"><label>Start time</label><input type="time" required value={bookForm.start_time} onChange={e=>setBookForm({...bookForm,start_time:e.target.value})}/></div>
                <div className="field"><label>End time</label><input type="time" required value={bookForm.end_time} onChange={e=>setBookForm({...bookForm,end_time:e.target.value})}/></div>
              </div>
              {clashMessage() && <div className="clash-warn">{clashMessage()}</div>}
              <div className="field"><label>Your name</label><input required value={bookForm.name} onChange={e=>setBookForm({...bookForm,name:e.target.value})}/></div>
              <div className="field"><label>Email</label><input type="email" required value={bookForm.email} onChange={e=>setBookForm({...bookForm,email:e.target.value})}/></div>
              <div className="field"><label>Phone (optional)</label><input type="tel" value={bookForm.phone} onChange={e=>setBookForm({...bookForm,phone:e.target.value})}/></div>
              <div className="field">
                <label>Event type</label>
                <select value={bookForm.type} onChange={e=>setBookForm({...bookForm,type:e.target.value})}>
                  <option>Wedding</option><option>Private party</option><option>Corporate event</option><option>Club / bar gig</option><option>Other</option>
                </select>
              </div>
              <div className="field"><label>Tell me about the event</label><textarea value={bookForm.message} onChange={e=>setBookForm({...bookForm,message:e.target.value})} placeholder="Venue, time, style of music, anything else"/></div>
              <div className="modal-actions">
                <button type="button" className="btn btn-close" onClick={()=>setBookingDate(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={!!clashMessage()}>Send request</button>
              </div>
              {bookMsg && <div className="msg">{bookMsg}</div>}
            </form>
          </div>
        </div>
      )}

      {showLogin && (
        <div className="overlay show" onClick={(e)=>{ if(e.target.classList.contains('overlay')) setShowLogin(false); }}>
          <div className="modal login-box">
            <h3>Admin login</h3>
            <div className="sub">Manage requests and the calendar.</div>
            <div className="field"><label>Password</label><input type="password" value={loginPass} onChange={e=>setLoginPass(e.target.value)}/></div>
            <div className="modal-actions">
              <button type="button" className="btn btn-close" onClick={()=>setShowLogin(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={tryLogin}>Log in</button>
            </div>
            {loginMsg && <div className="msg" style={{color:'#7c2532'}}>{loginMsg}</div>}
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="admin-bar">
          <div className="wrap">
            <div className="section-head"><div className="kicker">Admin</div><h2>Manage bookings</h2></div>
            <div className="tabs">
              <button className={"tab-btn " + (activeTab==='requests'?'active':'')} onClick={()=>setActiveTab('requests')}>Requests</button>
              <button className={"tab-btn " + (activeTab==='calendar'?'active':'')} onClick={()=>setActiveTab('calendar')}>Edit calendar</button>
              <button className={"tab-btn " + (activeTab==='profile'?'active':'')} onClick={openProfileTab}>Profile</button>
              <button className="tab-btn" style={{marginLeft:'auto',borderColor:'#7c2532',color:'#e2a3ab'}} onClick={()=>toggleAdmin(false)}>Log out</button>
            </div>

            {activeTab === 'requests' && (
              <div>
                {requests.length === 0 && <p className="empty-note">No requests yet.</p>}
                {[...requests].sort((a,b)=>a.date.localeCompare(b.date)).map(r=>{
                  const d = new Date(r.date+'T00:00:00');
                  const dateStr = d.toLocaleDateString(undefined,{weekday:'short',year:'numeric',month:'short',day:'numeric'});
                  const statusClass = r.status==='pending'?'st-pending':r.status==='approved'?'st-approved':'st-declined';
                  return (
                    <div className="req-card" key={r.id}>
                      <div className="req-info">
                        <b>{dateStr}</b>{r.start_time && r.end_time ? ', ' + formatRange({start:r.start_time, end:r.end_time}) : ''} — {r.name} <span className={"req-status "+statusClass}>{r.status}</span>
                        <div className="small">{r.type} · {r.email}{r.phone?' · '+r.phone:''}</div>
                        {r.message && <div className="small">{r.message}</div>}
                      </div>
                      {r.status === 'pending' && (
                        <div className="req-actions">
                          <button className="btn-approve" onClick={()=>decide(r.id,'approved')}>Approve</button>
                          <button className="btn-decline" onClick={()=>decide(r.id,'declined')}>Decline</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'calendar' && (
              <p style={{color:'var(--paper-soft)',fontSize:'0.92rem',maxWidth:'56ch'}}>
                Tap a date in the calendar above to block out the whole day, and tap again to unblock it.
                Individual gigs come from approved requests, so you don't need to add those here.
                Days already busy on the connected Google Calendar are handled automatically.
              </p>
            )}

            {activeTab === 'profile' && profileForm && (
              <div className="admin-form">
                <div className="field">
                  <label>Photo</label>
                  {profileForm.photo && <img src={profileForm.photo} alt="Preview" style={{width:90,height:90,borderRadius:'50%',objectFit:'cover',marginBottom:10,border:'2px solid var(--brass)'}}/>}
                  <input type="file" accept="image/*" onChange={async (e)=>{
                    const file = e.target.files[0];
                    if(!file) return;
                    const dataUrl = await fileToResizedDataUrl(file);
                    setProfileForm({...profileForm, photo: dataUrl});
                  }}/>
                </div>
                <div className="field"><label>Name</label><input value={profileForm.name} onChange={e=>setProfileForm({...profileForm,name:e.target.value})}/></div>
                <div className="field"><label>Tagline</label><input value={profileForm.tagline} onChange={e=>setProfileForm({...profileForm,tagline:e.target.value})}/></div>
                <div className="field"><label>Bio</label><textarea style={{minHeight:100}} value={profileForm.bio} onChange={e=>setProfileForm({...profileForm,bio:e.target.value})}/></div>
                <div className="field"><label>Booking email</label><input value={profileForm.email} onChange={e=>setProfileForm({...profileForm,email:e.target.value})}/></div>
                <div className="field"><label>Instagram</label><input value={profileForm.instagram} onChange={e=>setProfileForm({...profileForm,instagram:e.target.value})}/></div>
                <div className="field"><label>Typical rate</label><input value={profileForm.rate} onChange={e=>setProfileForm({...profileForm,rate:e.target.value})}/></div>
                <div className="field">
                  <label>Minutes needed between gigs</label>
                  <input type="number" min="0" max="480" value={profileForm.buffer_minutes ?? 60} onChange={e=>setProfileForm({...profileForm,buffer_minutes:e.target.value})}/>
                </div>
                <button className="btn btn-primary" onClick={saveProfile}>Save profile</button>
                {profileMsg && <div className="msg" style={{color:'#dcae4c'}}>{profileMsg}</div>}
              </div>
            )}
          </div>
        </div>
      )}

      <div className={"toast " + (toastMsg ? 'show' : '')}>{toastMsg}</div>
    </>
  );
}