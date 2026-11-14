import { db } from '../../lib/db';

const BUCKET = 'ibase-photos'; // same public bucket as photos
const MAX_BYTES = 100 * 1024 * 1024; // app limit; Supabase's own limit (50 MB on the free plan) applies too

// Videos are sent as the raw file (not base64 JSON), so Next's body parser must be off.
// Headers: Content-Type = the video's mime type, x-filename = URL-encoded original file name.
// Returns { ok, url } — a public URL that Facebook / Instagram / LinkedIn can fetch.
export const config = { api: { bodyParser: false, responseLimit: false } };

const EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const mediaType = String(req.headers['content-type'] || '').split(';')[0];
  if (!mediaType.startsWith('video/')) return res.status(400).json({ ok: false, error: 'Please upload a video file (MP4 or MOV).' });

  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BYTES) return res.status(413).json({ ok: false, error: 'Video is too large (max 100 MB).' });
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) return res.status(400).json({ ok: false, error: 'The video file was empty.' });

    let name = 'video';
    try { name = decodeURIComponent(String(req.headers['x-filename'] || 'video')); } catch {}
    name = name.replace(/[^a-zA-Z0-9._-]/g, '') || 'video';
    if (!/\.(mp4|mov|m4v|webm)$/i.test(name)) name += '.' + (EXT[mediaType] || 'mp4');
    const path = `${Date.now()}-${name}`;

    const { error } = await db.storage.from(BUCKET).upload(path, buffer, { contentType: mediaType, upsert: false });
    if (error) {
      const tooBig = /exceeded|too large|maximum allowed/i.test(error.message || '');
      return res.status(tooBig ? 413 : 500).json({
        ok: false,
        error: tooBig ? 'Video is larger than your Supabase storage limit (50 MB on the free plan). Use a shorter or smaller video.' : String(error.message || error),
      });
    }

    const { data } = db.storage.from(BUCKET).getPublicUrl(path);
    res.status(200).json({ ok: true, url: data.publicUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
