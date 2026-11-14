import { useState } from 'react';
import Head from 'next/head';
import { listConnectedAccounts, listPostHistory, listScheduledPosts } from '../lib/db';

export async function getServerSideProps() {
  const [accounts, history, scheduled] = await Promise.all([
    listConnectedAccounts().catch(() => []),
    listPostHistory(200).catch(() => []),
    listScheduledPosts(100).catch(() => []),
  ]);
  return { props: { accounts, history, scheduled } };
}

const PLATFORM_LABELS = { linkedin: 'LinkedIn', instagram: 'Instagram', twitter: 'X / Twitter', facebook: 'Facebook' };
const PLATFORM_DOT = { linkedin: '#0A66C2', instagram: '#C1327A', twitter: '#111111', facebook: '#1877F2' };

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const MAX_VIDEO_MB = 50; // Supabase free plan's per-file limit
const isVideoUrl = (u) => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u || '');

// Grabs one frame from a video (as a small JPEG, base64) so Gemini can write captions about it.
function videoFrameBase64(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    const done = (fn, val) => { URL.revokeObjectURL(url); fn(val); };
    v.onerror = () => done(reject, new Error('Could not read this video. Use an MP4 file.'));
    v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
    v.onseeked = () => {
      const scale = Math.min(1, 768 / (v.videoWidth || 768));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round((v.videoWidth || 768) * scale);
      canvas.height = Math.round((v.videoHeight || 432) * scale);
      canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
      done(resolve, canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
    };
    v.src = url;
  });
}

// Uploads the chosen photo or video to storage and returns its public URL plus an image to caption from.
async function prepareMedia(file) {
  if (file.type.startsWith('video/')) {
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      throw new Error(`This video is ${(file.size / 1048576).toFixed(0)} MB. Please use a video under ${MAX_VIDEO_MB} MB.`);
    }
    const [frame, uploadRes] = await Promise.all([
      videoFrameBase64(file),
      fetch('/api/upload-video', {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'x-filename': encodeURIComponent(file.name) },
        body: file,
      }),
    ]);
    const data = await uploadRes.json();
    if (!data.ok) throw new Error(data.error);
    return { url: data.url, captionBase64: frame, captionType: 'image/jpeg', isVideo: true };
  }

  const base64 = await fileToBase64(file);
  const uploadRes = await fetch('/api/upload-photo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: base64, mediaType: file.type, filename: file.name }),
  });
  const data = await uploadRes.json();
  if (!data.ok) throw new Error(data.error);
  return { url: data.url, captionBase64: base64, captionType: file.type, isVideo: false };
}

// Shows a photo as an image and a video as a small player.
function MediaThumb({ url }) {
  if (!url) return null;
  return isVideoUrl(url) ? (
    <a className="history-thumb-link" href={url} target="_blank" rel="noreferrer">
      <video className="history-thumb" src={url} muted preload="metadata" />
    </a>
  ) : (
    <a className="history-thumb-link" href={url} target="_blank" rel="noreferrer">
      <img className="history-thumb" src={url} alt="" />
    </a>
  );
}

function formatWhen(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Value for <input type="datetime-local"> (browser-local time), offset by `minutes` from now.
function localInputValue(minutes = 0) {
  const d = new Date(Date.now() + minutes * 60000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const SCHEDULE_STATUS = { pending: 'Scheduled', processing: 'Publishing', posted: 'Posted', failed: 'Failed', cancelled: 'Cancelled' };

export default function Home({ accounts, history, scheduled = [] }) {
  async function disconnectAccount(platform, externalId, displayName) {
    if (!confirm(`Disconnect ${displayName || externalId}? This app will stop being able to post to it.`)) return;
    const res = await fetch('/api/accounts/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, externalId }),
    });
    const data = await res.json();
    if (!data.ok) {
      alert('Could not disconnect: ' + data.error);
      return;
    }
    window.location.reload();
  }
  // Schedule time is picked as date + hour (1-12) + minute + AM/PM, then combined into one local time.
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleHour, setScheduleHour] = useState('9');
  const [scheduleMinute, setScheduleMinute] = useState('00');
  const [scheduleAmPm, setScheduleAmPm] = useState('AM');
  const scheduleAt = scheduleDate
    ? `${scheduleDate}T${String((Number(scheduleHour) % 12) + (scheduleAmPm === 'PM' ? 12 : 0)).padStart(2, '0')}:${scheduleMinute}`
    : '';
  const [scheduling, setScheduling] = useState(false);

  async function scheduleAll() {
    if (!captions || !uploadedUrl) return;
    if (!scheduleAt) { alert('Pick a date and time first.'); return; }
    const when = new Date(scheduleAt);
    if (isNaN(when.getTime()) || when.getTime() < Date.now() + 60000) {
      alert('Pick a time at least a minute in the future.');
      return;
    }
    const items = [];
    for (const platform of Object.keys(captions)) {
      const block = captions[platform];
      const fullCaption = block.caption + (block.hashtags?.length ? '\n\n' + block.hashtags.map((h) => '#' + h).join(' ') : '');
      for (const a of accounts.filter((x) => x.platform === platform)) {
        items.push({ platform, externalId: a.external_id, accountName: a.display_name, caption: fullCaption });
      }
    }
    if (!items.length) { alert('No connected accounts match these captions.'); return; }
    setScheduling(true);
    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: uploadedUrl, scheduledFor: when.toISOString(), items }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      window.location.reload();
    } catch (err) {
      alert('Could not schedule: ' + err.message);
      setScheduling(false);
    }
  }

  async function cancelScheduled(id) {
    if (!confirm('Cancel this scheduled post?')) return;
    const res = await fetch('/api/schedule/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!data.ok) { alert('Could not cancel: ' + data.error); return; }
    window.location.reload();
  }

  async function deleteHistory(ids, message) {
    if (!ids.length || !confirm(message)) return;
    const res = await fetch('/api/history/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json();
    if (!data.ok) { alert('Could not delete: ' + data.error); return; }
    window.location.reload();
  }

  const [histPlatform, setHistPlatform] = useState('all');
  const [histStatus, setHistStatus] = useState('all');
  const accountNames = Object.fromEntries(accounts.map((a) => [a.external_id, a.display_name]));
  const filteredHistory = (history || []).filter(
    (h) =>
      (histPlatform === 'all' || h.platform === histPlatform) &&
      (histStatus === 'all' || h.status === histStatus)
  );
  const okCount = (history || []).filter((h) => h.status === 'success').length;
  const failCount = (history || []).length - okCount;

  const pendingCount = scheduled.filter((p) => p.status === 'pending').length;
  const [activeTab, setActiveTab] = useState('compose');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [photoType, setPhotoType] = useState('general institute activity');
  const [tone, setTone] = useState('professional and encouraging');
  const [captions, setCaptions] = useState(null);
  const [uploadedUrl, setUploadedUrl] = useState(null);
  const [status, setStatus] = useState('idle');
  const [log, setLog] = useState([]);

  function onFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setCaptions(null);
    setUploadedUrl(null);
  }

  async function generate() {
    if (!file) return;
    setStatus('generating');
    try {
      const media = await prepareMedia(file);
      const uploadData = { url: media.url };
      setUploadedUrl(media.url);

      const connectedPlatforms = [...new Set(accounts.map((a) => a.platform))];
      const platformsToGenerate = connectedPlatforms.length ? connectedPlatforms : ['linkedin', 'instagram', 'twitter', 'facebook'];

      const capRes = await fetch('/api/generate-captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: media.captionBase64,
          mediaType: media.captionType,
          bizName: 'iBase Electrosoft LLP',
          bizType: 'IT training & placement institute',
          tone,
          photoType: media.isVideo ? photoType + ' (this image is a frame from a short video, write the captions for the video)' : photoType,
          platforms: platformsToGenerate,
        }),
      });
      const capData = await capRes.json();
      if (!capData.ok) throw new Error(capData.error);
      setCaptions(capData.captions);
      setStatus('ready');
    } catch (err) {
      alert('Something went wrong: ' + err.message);
      setStatus('idle');
    }
  }

  async function postTo(platform, account) {
    const block = captions[platform];
    const fullCaption = block.caption + (block.hashtags?.length ? '\n\n' + block.hashtags.map((h) => '#' + h).join(' ') : '');
    const endpoint = platform === 'linkedin' ? '/api/post/linkedin' : '/api/post/meta';
    const body =
      platform === 'linkedin'
        ? { authorUrn: account.external_id, imageUrl: uploadedUrl, caption: fullCaption }
        : { platform, pageId: account.external_id, imageUrl: uploadedUrl, caption: fullCaption };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setLog((prev) => [{ platform, ok: data.ok, detail: data.ok ? 'Posted successfully' : data.error }, ...prev]);
  }

  // NEW: one-click flow — upload photo, generate captions, then post to every connected platform automatically.
  // Added as a standalone function so the existing generate() and postTo() flows above are untouched.
  async function generateAndPostAll() {
    if (!file) return;
    setStatus('generating');
    try {
      const media = await prepareMedia(file);
      const uploadData = { url: media.url };
      setUploadedUrl(media.url);

      const connectedPlatforms = [...new Set(accounts.map((a) => a.platform))];
      const platformsToGenerate = connectedPlatforms.length ? connectedPlatforms : ['linkedin', 'instagram', 'twitter', 'facebook'];

      const capRes = await fetch('/api/generate-captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: media.captionBase64,
          mediaType: media.captionType,
          bizName: 'iBase Electrosoft LLP',
          bizType: 'IT training & placement institute',
          tone,
          photoType: media.isVideo ? photoType + ' (this image is a frame from a short video, write the captions for the video)' : photoType,
          platforms: platformsToGenerate,
        }),
      });
      const capData = await capRes.json();
      if (!capData.ok) throw new Error(capData.error);
      setCaptions(capData.captions);
      setStatus('ready');

      // Post to every connected account for each platform (there can be more than
      // one Facebook connection, for example) — not just the first match.
      for (const platform of Object.keys(capData.captions)) {
        const matchingAccounts = accounts.filter((a) => a.platform === platform);
        if (!matchingAccounts.length) continue;

        const block = capData.captions[platform];
        const fullCaption =
          block.caption + (block.hashtags?.length ? '\n\n' + block.hashtags.map((h) => '#' + h).join(' ') : '');
        const endpoint = platform === 'linkedin' ? '/api/post/linkedin' : '/api/post/meta';

        for (const account of matchingAccounts) {
          const body =
            platform === 'linkedin'
              ? { authorUrn: account.external_id, imageUrl: uploadData.url, caption: fullCaption }
              : { platform, pageId: account.external_id, imageUrl: uploadData.url, caption: fullCaption };

          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          setLog((prev) => [
            { platform, account: account.display_name || account.external_id, ok: data.ok, detail: data.ok ? 'Posted successfully' : data.error },
            ...prev,
          ]);
        }
      }
    } catch (err) {
      alert('Something went wrong: ' + err.message);
      setStatus('idle');
    }
  }

  return (
    <div className="page">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,500;0,600;0,700;1,500&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </Head>

      <header className="masthead">
        <div className="mark">iB</div>
        <div>
          <h1>iBase Poster</h1>
          <p>Log a photo, review the entry for each platform, publish.</p>
        </div>
        <a className="logout" href="/api/logout">Log out</a>
      </header>

      <main className="sheet">
        <nav className="tabs">
          <button
            type="button"
            className={`tab ${activeTab === 'compose' ? 'active' : ''}`}
            onClick={() => setActiveTab('compose')}
          >
            Compose
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            History
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'scheduled' ? 'active' : ''}`}
            onClick={() => setActiveTab('scheduled')}
          >
            Scheduled{pendingCount ? ` (${pendingCount})` : ''}
          </button>
        </nav>

        {activeTab === 'scheduled' ? (
          <section className="block">
            <div className="block-head">
              <h2>Scheduled posts</h2>
            </div>
            {scheduled.length === 0 ? (
              <p className="empty">Nothing scheduled. Generate captions on the Compose tab, then pick a date and time.</p>
            ) : (
              <div className="history-list">
                {scheduled.map((p) => (
                  <article className="history-card" key={p.id}>
                    <div className="history-meta">
                      <span className="dot" style={{ background: PLATFORM_DOT[p.platform] || '#999' }} />
                      <strong>{PLATFORM_LABELS[p.platform] || p.platform}</strong>
                      <span className="sched-account">{p.account_name || ''}</span>
                      <span className={`status-pill sched-${p.status}`}>{SCHEDULE_STATUS[p.status] || p.status}</span>
                      <time className="history-time">{formatWhen(p.scheduled_for)}</time>
                    </div>
                    <MediaThumb url={p.image_url} />
                    <p className="history-caption">
                      {(p.caption || '').trim().slice(0, 160)}
                      {(p.caption || '').length > 160 ? '…' : ''}
                    </p>
                    {p.status === 'failed' && p.error && <p className="sched-error">{p.error}</p>}
                    {p.status === 'pending' && (
                      <button type="button" className="disconnect-btn" onClick={() => cancelScheduled(p.id)}>
                        Cancel
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : activeTab === 'history' ? (
          <section className="block">
            <div className="block-head">
              <h2>Post history</h2>
            </div>
            {history && history.length > 0 && (
              <div className="hist-filters">
                <span className="hist-count">{okCount} posted · {failCount} failed</span>
                <select value={histPlatform} onChange={(e) => setHistPlatform(e.target.value)}>
                  <option value="all">All platforms</option>
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                  <option value="linkedin">LinkedIn</option>
                </select>
                <select value={histStatus} onChange={(e) => setHistStatus(e.target.value)}>
                  <option value="all">All results</option>
                  <option value="success">Posted</option>
                  <option value="error">Failed</option>
                </select>
                {filteredHistory.length > 0 && (
                  <button
                    type="button"
                    className="hist-clear-btn"
                    onClick={() =>
                      deleteHistory(
                        filteredHistory.map((h) => h.id),
                        filteredHistory.length === history.length
                          ? `Delete all ${history.length} history entries? This cannot be undone. (Posts already published on social media are not removed.)`
                          : `Delete the ${filteredHistory.length} entries currently shown? This cannot be undone. (Posts already published on social media are not removed.)`
                      )
                    }
                  >
                    {filteredHistory.length === history.length ? 'Clear all' : `Delete ${filteredHistory.length} shown`}
                  </button>
                )}
              </div>
            )}
            {(!history || history.length === 0) ? (
              <p className="empty">No posts logged yet. Posts you publish will show up here.</p>
            ) : filteredHistory.length === 0 ? (
              <p className="empty">No posts match these filters.</p>
            ) : (
              <div className="history-list">
                {filteredHistory.map((entry) => {
                  const when = entry.created_at
                    ? new Date(entry.created_at).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })
                    : '';
                  const captionPreview = (entry.caption || '').trim().slice(0, 160);
                  return (
                    <article className="history-card" key={entry.id}>
                      <div className="history-meta">
                        <span
                          className="dot"
                          style={{ background: PLATFORM_DOT[entry.platform] || '#999' }}
                        />
                        <strong>{PLATFORM_LABELS[entry.platform] || entry.platform}</strong>
                        <span className="sched-account">{accountNames[entry.external_id] || entry.external_id}</span>
                        <span className={`status-pill ${entry.status === 'success' ? 'ok' : 'err'}`}>
                          {entry.status === 'success' ? 'Posted' : 'Failed'}
                        </span>
                        <time className="history-time">{when}</time>
                        <button
                          type="button"
                          className="hist-delete-btn"
                          title="Delete this entry"
                          onClick={() =>
                            deleteHistory([entry.id], 'Delete this history entry? (The post stays on social media.)')
                          }
                        >
                          Delete
                        </button>
                      </div>
                      <MediaThumb url={entry.image_url} />
                      {captionPreview && (
                        <p className="history-caption">
                          {captionPreview}
                          {(entry.caption || '').length > 160 ? '…' : ''}
                        </p>
                      )}
                      {entry.status !== 'success' && entry.response && (
                        <p className="sched-error">
                          {typeof entry.response === 'string' ? entry.response : JSON.stringify(entry.response)}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : (
        <>
        <section className="block">
          <div className="block-head">
            <h2>Connected accounts</h2>
          </div>

          {accounts.length === 0 ? (
            <p className="empty">No accounts logged yet — connect one below before posting.</p>
          ) : (
            <div className="ledger-scroll">
            <table className="ledger">
              <tbody>
                {accounts.map((a, i) => (
                  <tr key={a.platform + a.external_id}>
                    <td className="roll">{String(i + 1).padStart(2, '0')}</td>
                    <td>
                      <span className="dot" style={{ background: PLATFORM_DOT[a.platform] || '#999' }} />
                      {PLATFORM_LABELS[a.platform] || a.platform}
                    </td>
                    <td className="name">{a.display_name || a.external_id}</td>
                    <td className="disconnect-cell">
                      <button
                        type="button"
                        className="disconnect-btn"
                        onClick={() => disconnectAccount(a.platform, a.external_id, a.display_name)}
                      >
                        Disconnect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}

          <div className="connect-row">
            <a className="link" href="/api/auth/meta/start">+ Connect Facebook &amp; Instagram</a>
            <a className="link" href="/api/auth/linkedin/start">+ Connect LinkedIn</a>
          </div>
        </section>

        <section className="block">
          <div className="block-head">
            <h2>Upload a photo or video</h2>
          </div>

          <label className="dropzone">
            <input type="file" accept="image/*,video/mp4,video/quicktime,video/webm" onChange={onFileChange} />
            {preview ? (
              file && file.type.startsWith('video/') ? (
                <video src={preview} controls muted playsInline />
              ) : (
                <img src={preview} alt="Selected" />
              )
            ) : (
              <span>Click to choose a photo or video (MP4 or MOV, up to {MAX_VIDEO_MB} MB)</span>
            )}
          </label>

          <div className="field-row">
            <label className="field">
              <span>Photo is about</span>
              <select value={photoType} onChange={(e) => setPhotoType(e.target.value)}>
                <option value="a live training / classroom session">Training session</option>
                <option value="a student placement success">Placement success</option>
                <option value="an event, workshop or seminar">Event / workshop</option>
                <option value="general institute activity">General / mixed</option>
              </select>
            </label>
            <label className="field">
              <span>Tone</span>
              <select value={tone} onChange={(e) => setTone(e.target.value)}>
                <option value="professional and encouraging">Professional &amp; encouraging</option>
                <option value="warm and friendly">Warm &amp; friendly</option>
                <option value="celebratory and proud">Celebratory &amp; proud</option>
                <option value="fun and energetic">Fun &amp; energetic</option>
              </select>
            </label>
          </div>

        </section>

        <section className="block">
          <div className="block-head">
            <h2>Generate captions</h2>
          </div>
          <p className="empty">Uploads the photo and writes captions for you to review before posting.</p>
          <button className="btn-primary" onClick={generate} disabled={!file || status === 'generating'}>
            {status === 'generating' ? 'Writing captions…' : 'Generate captions'}
          </button>
        </section>

        <section className="block">
          <div className="block-head">
            <h2>Post to all platforms</h2>
          </div>
          <p className="empty">Uploads the photo and posts it to every connected platform automatically — one click.</p>
          <button className="btn-primary btn-oneclick" onClick={generateAndPostAll} disabled={!file || status === 'generating'}>
            {status === 'generating' ? 'Posting…' : 'Post to All Platforms'}
          </button>
        </section>

        {captions && (
          <section className="block">
            <div className="block-head">
              <h2>Captions by platform</h2>
            </div>

            {Object.keys(captions).map((platform, i) => {
              const block = captions[platform];
              const account = accounts.find((a) => a.platform === platform);
              return (
                <div className="entry" key={platform}>
                  <div className="entry-head">
                    <span className="roll">{String(i + 1).padStart(2, '0')}</span>
                    <span className="dot" style={{ background: PLATFORM_DOT[platform] || '#999' }} />
                    <strong>{PLATFORM_LABELS[platform]}</strong>
                  </div>
                  <textarea
                    className="ruled"
                    value={block.caption}
                    onChange={(e) =>
                      setCaptions((prev) => ({ ...prev, [platform]: { ...prev[platform], caption: e.target.value } }))
                    }
                  />
                  <div className="tags">
                    {(block.hashtags || []).map((h) => (
                      <span className="tag" key={h}>#{h}</span>
                    ))}
                  </div>
                  {account ? (
                    <button className="btn-post" onClick={() => postTo(platform, account)}>
                      Post to {PLATFORM_LABELS[platform]}
                    </button>
                  ) : (
                    <span className="warn">No {PLATFORM_LABELS[platform]} account connected</span>
                  )}
                </div>
              );
            })}

            <div className="schedule-box">
              <h3>Or schedule it</h3>
              <p className="empty">Publishes these captions to every connected account at the time you pick.</p>
              <div className="schedule-row">
                <input
                  type="date"
                  value={scheduleDate}
                  min={localInputValue(0).slice(0, 10)}
                  onChange={(e) => setScheduleDate(e.target.value)}
                />
                <select value={scheduleHour} onChange={(e) => setScheduleHour(e.target.value)} aria-label="Hour">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
                    <option key={h} value={String(h)}>{h}</option>
                  ))}
                </select>
                <span className="time-colon">:</span>
                <select value={scheduleMinute} onChange={(e) => setScheduleMinute(e.target.value)} aria-label="Minute">
                  {Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0')).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <select value={scheduleAmPm} onChange={(e) => setScheduleAmPm(e.target.value)} aria-label="AM or PM">
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
                <button type="button" className="btn-primary" onClick={scheduleAll} disabled={scheduling || !scheduleAt}>
                  {scheduling ? 'Scheduling…' : 'Schedule all'}
                </button>
              </div>
              {scheduleAt && (
                <p className="empty">Will post on {formatWhen(new Date(scheduleAt).toISOString())}</p>
              )}
            </div>
          </section>
        )}

        {log.length > 0 && (
          <section className="block">
            <div className="block-head">
              <h2>Posting log</h2>
            </div>
            <ul className="log">
              {log.map((l, i) => (
                <li key={i} className={l.ok ? 'ok' : 'err'}>
                  {l.ok ? <span className="stamp">POSTED</span> : <span className="icon">✕</span>}
                  <span><strong>{PLATFORM_LABELS[l.platform] || l.platform}</strong> — {l.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        </>
        )}

        <p className="footnote">
          WhatsApp Status isn't listed here — no platform offers a posting API for it, so it stays outside this
          flow regardless of approach.
        </p>
      </main>

      <style jsx>{`
        :global(html, body) {
          margin: 0;
          background: #122b4f;
          font-family: 'Inter', sans-serif;
          color: #1b1611;
        }
        .page {
          min-height: 100vh;
        }
        .masthead {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 32px max(20px, calc(50% - 340px));
          color: #f6f4ec;
        }
        .logout {
          margin-left: auto;
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          color: #d8d2c2;
          text-decoration: none;
          border: 1px solid rgba(246, 244, 236, 0.35);
          border-radius: 6px;
          padding: 6px 12px;
        }
        .logout:hover {
          color: #f6f4ec;
          border-color: #f6f4ec;
        }
        .mark {
          width: 44px;
          height: 44px;
          flex: 0 0 auto;
          border-radius: 6px;
          background: #2f8f5b;
          color: #f6f4ec;
          font-family: 'Newsreader', serif;
          font-style: italic;
          font-weight: 700;
          font-size: 19px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .masthead h1 {
          font-family: 'Newsreader', serif;
          font-style: italic;
          font-weight: 600;
          font-size: 28px;
          margin: 0;
          letter-spacing: -0.01em;
        }
        .masthead p {
          margin: 4px 0 0;
          font-size: 13.5px;
          color: rgba(246, 244, 236, 0.75);
        }
        .sheet {
          background: #f6f4ec;
          max-width: 680px;
          margin: 0 auto 60px;
          padding: 8px max(20px, calc(50% - 340px)) 40px;
          border-radius: 14px 14px 0 0;
        }
        .tabs {
          display: flex;
          gap: 4px;
          padding: 16px 0 4px;
          border-bottom: 1px solid rgba(27, 22, 17, 0.12);
          margin-bottom: 4px;
        }
        .tab {
          background: transparent;
          border: none;
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 500;
          color: #8a8068;
          padding: 8px 16px;
          border-radius: 6px 6px 0 0;
          cursor: pointer;
        }
        .tab:hover {
          color: #1b1611;
        }
        .tab.active {
          color: #1b1611;
          background: rgba(47, 143, 91, 0.12);
          font-weight: 600;
        }
        .history-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .history-card {
          background: #fff;
          border: 1px solid rgba(27, 22, 17, 0.12);
          border-radius: 8px;
          padding: 14px 16px;
        }
        .history-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          font-size: 13.5px;
          margin-bottom: 10px;
        }
        .history-time {
          margin-left: auto;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11.5px;
          color: #8a8068;
        }
        .status-pill {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 20px;
        }
        .status-pill.ok {
          background: rgba(47, 143, 91, 0.15);
          color: #2f8f5b;
        }
        .status-pill.err {
          background: rgba(181, 72, 47, 0.12);
          color: #b5482f;
        }
        .history-thumb-link {
          display: block;
          margin-bottom: 10px;
        }
        .history-thumb {
          width: 100%;
          max-height: 180px;
          object-fit: cover;
          border-radius: 6px;
          border: 1px solid rgba(27, 22, 17, 0.08);
        }
        .history-caption {
          margin: 0;
          font-size: 13.5px;
          line-height: 1.45;
          color: #3a3428;
          white-space: pre-wrap;
        }
        .hist-filters {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }
        .hist-count {
          margin-right: auto;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          color: #6b6150;
        }
        .hist-filters select {
          padding: 7px 9px;
          border-radius: 5px;
          border: 1.5px solid rgba(27, 22, 17, 0.18);
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          background: #fff;
        }
        .hist-delete-btn,
        .hist-clear-btn {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          color: #b5482f;
          background: transparent;
          border: 1.5px solid rgba(181, 72, 47, 0.4);
          border-radius: 5px;
          padding: 4px 10px;
          cursor: pointer;
        }
        .hist-clear-btn {
          font-size: 13px;
          padding: 7px 12px;
        }
        .hist-delete-btn:hover,
        .hist-clear-btn:hover {
          background: rgba(181, 72, 47, 0.1);
        }
        .schedule-box {
          margin-top: 22px;
          padding: 16px;
          border: 1px dashed rgba(27, 22, 17, 0.28);
          border-radius: 8px;
        }
        .schedule-box h3 {
          font-family: 'Newsreader', serif;
          font-size: 18px;
          margin: 0 0 4px;
        }
        .schedule-row {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }
        .time-colon {
          font-weight: 600;
        }
        .schedule-row select,
        .schedule-row input {
          padding: 9px 10px;
          border-radius: 5px;
          border: 1.5px solid rgba(27, 22, 17, 0.18);
          font-family: 'Inter', sans-serif;
          font-size: 13.5px;
          background: #fff;
        }
        .schedule-row .btn-primary {
          margin-top: 0;
        }
        .sched-account {
          color: #6b6150;
        }
        .sched-error {
          margin: 8px 0 0;
          font-size: 12.5px;
          color: #b5482f;
          word-break: break-word;
        }
        .status-pill.sched-pending,
        .status-pill.sched-processing {
          background: rgba(232, 163, 61, 0.2);
          color: #8a5a0e;
        }
        .status-pill.sched-posted {
          background: rgba(47, 143, 91, 0.15);
          color: #2f8f5b;
        }
        .status-pill.sched-failed {
          background: rgba(181, 72, 47, 0.12);
          color: #b5482f;
        }
        .status-pill.sched-cancelled {
          background: #e8e3d3;
          color: #6b6150;
        }
        .block {
          padding: 28px 0;
          border-bottom: 1px solid rgba(27, 22, 17, 0.12);
        }
        .block:last-of-type {
          border-bottom: none;
        }
        .eyebrow {
          display: none;
        }
        .block-head {
          margin-bottom: 16px;
        }
        .block-head h2 {
          font-family: 'Newsreader', serif;
          font-weight: 600;
          font-size: 22px;
          margin: 0;
          letter-spacing: -0.005em;
        }
        .empty {
          font-size: 14px;
          color: #6b6150;
        }
        .ledger-scroll {
          overflow-x: auto;
        }
        .ledger {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
          table-layout: fixed;
        }
        .ledger tr {
          border-bottom: 1px solid rgba(27, 22, 17, 0.1);
        }
        .ledger td {
          padding: 10px 6px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .roll {
          font-family: 'IBM Plex Mono', monospace;
          color: #8a8068;
          width: 28px;
        }
        .dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 8px;
        }
        .name {
          color: #4a4536;
        }
        .disconnect-cell {
          text-align: right;
          width: 76px;
          white-space: nowrap;
        }
        .disconnect-btn {
          background: none;
          border: none;
          color: #b5482f;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          cursor: pointer;
          padding: 4px 0;
          white-space: nowrap;
        }
        .disconnect-btn:hover {
          text-decoration: underline;
        }
        .connect-row {
          display: flex;
          gap: 18px;
          margin-top: 16px;
          flex-wrap: wrap;
        }
        .link {
          font-size: 13.5px;
          font-weight: 600;
          color: #2f8f5b;
          text-decoration: none;
        }
        .link:hover {
          text-decoration: underline;
        }
        .dropzone {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          gap: 8px;
          border: 1.5px dashed rgba(27, 22, 17, 0.28);
          border-radius: 8px;
          padding: 28px;
          cursor: pointer;
          font-size: 13.5px;
          color: #6b6150;
          transition: border-color 0.15s ease;
        }
        .dropzone:hover {
          border-color: #2f8f5b;
        }
        .dropzone input {
          display: none;
        }
        .dropzone img,
        .dropzone video {
          max-width: 260px;
          max-height: 220px;
          border-radius: 6px;
          display: block;
        }
        .field-row {
          display: flex;
          gap: 14px;
          margin-top: 16px;
          flex-wrap: wrap;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1;
          min-width: 200px;
        }
        .field span {
          font-family: 'Inter', sans-serif;
          font-size: 12.5px;
          color: #6b6150;
        }
        .field select {
          padding: 9px 10px;
          border-radius: 5px;
          border: 1.5px solid rgba(27, 22, 17, 0.18);
          font-family: 'Inter', sans-serif;
          font-size: 13.5px;
          background: #fff;
        }
        .btn-primary {
          margin-top: 18px;
          background: #2f8f5b;
          color: #f6f4ec;
          border: none;
          padding: 11px 22px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 13.5px;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .btn-oneclick {
          background: #e8a33d;
          color: #1b1611;
        }
        .entry {
          padding: 16px 0;
          border-bottom: 1px solid rgba(27, 22, 17, 0.1);
        }
        .entry:last-child {
          border-bottom: none;
        }
        .entry-head {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
          font-size: 14px;
        }
        .ruled {
          width: 100%;
          min-height: 84px;
          padding: 10px 12px;
          font-family: 'Inter', sans-serif;
          font-size: 13.5px;
          line-height: 24px;
          border: 1px solid rgba(27, 22, 17, 0.15);
          border-radius: 6px;
          background: repeating-linear-gradient(
            to bottom,
            #fff,
            #fff 23px,
            rgba(47, 143, 91, 0.15) 24px
          );
          resize: vertical;
        }
        .tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin: 10px 0;
        }
        .tag {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          background: #e8e3d3;
          color: #4a4536;
          padding: 3px 8px;
          border-radius: 20px;
        }
        .btn-post {
          background: #e8a33d;
          color: #1b1611;
          border: none;
          padding: 8px 16px;
          border-radius: 5px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
        }
        .warn {
          font-size: 12.5px;
          color: #b5482f;
        }
        .log {
          list-style: none;
          margin: 0;
          padding: 0;
          font-size: 13.5px;
        }
        .log li {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 7px 0;
        }
        .stamp {
          flex: 0 0 auto;
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: 1.5px solid #2f8f5b;
          color: #2f8f5b;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.02em;
          display: flex;
          align-items: center;
          justify-content: center;
          transform: rotate(-9deg);
        }
        .icon {
          display: inline-block;
          width: 16px;
          text-align: center;
        }
        .log .err .icon {
          color: #b5482f;
        }
        .footnote {
          font-size: 11.5px;
          color: #8a8068;
          margin-top: 24px;
        }
      `}</style>
    </div>
  );
}