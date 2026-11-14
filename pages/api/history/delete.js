import { deletePostHistory } from '../../../lib/db';

// Expects JSON body: { ids: [uuid, ...] } (or { id }). Removes rows from the app's history only.
// Posts that were already published on Facebook/Instagram/LinkedIn are NOT deleted there.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const body = req.body || {};
  const ids = (Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : []).filter(
    (x) => typeof x === 'string' && x
  );
  if (!ids.length) return res.status(400).json({ ok: false, error: 'ids are required' });
  if (ids.length > 1000) return res.status(400).json({ ok: false, error: 'Too many items at once' });
  try {
    const deleted = await deletePostHistory(ids);
    res.status(200).json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
