import { db } from '../../lib/db';

const BUCKET = 'ibase-photos';

// Expects JSON body: { imageBase64, mediaType, filename }
// Returns { url } — a public URL that Meta/LinkedIn's APIs can fetch server-side.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { imageBase64, mediaType, filename } = req.body;

  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });

  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const path = `${Date.now()}-${(filename || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '')}`;

    const { error } = await db.storage.from(BUCKET).upload(path, buffer, {
      contentType: mediaType || 'image/jpeg',
      upsert: false,
    });
    if (error) throw error;

    const { data } = db.storage.from(BUCKET).getPublicUrl(path);
    res.status(200).json({ ok: true, url: data.publicUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
