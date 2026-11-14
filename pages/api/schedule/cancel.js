import { cancelScheduledPost } from '../../../lib/db';

// Expects JSON body: { id }. Only posts that haven't started publishing can be cancelled.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'id is required' });
  try {
    const cancelled = await cancelScheduledPost(id);
    if (!cancelled) return res.status(409).json({ ok: false, error: 'This post is no longer pending' });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
