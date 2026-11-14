import { createScheduledPosts } from '../../../lib/db';

const MIN_LEAD_MS = 60 * 1000; // at least 1 minute ahead
const MAX_LEAD_MS = 90 * 24 * 60 * 60 * 1000; // at most 90 days ahead

// Expects JSON body:
// { imageUrl, scheduledFor (ISO string), items: [{ platform, externalId, accountName, caption }] }
export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { imageUrl, scheduledFor, items } = req.body || {};

  if (!imageUrl || !scheduledFor || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'imageUrl, scheduledFor and items are required' });
  }
  const when = new Date(scheduledFor);
  if (isNaN(when.getTime())) return res.status(400).json({ ok: false, error: 'scheduledFor is not a valid date' });
  const lead = when.getTime() - Date.now();
  if (lead < MIN_LEAD_MS) return res.status(400).json({ ok: false, error: 'Pick a time at least a minute in the future' });
  if (lead > MAX_LEAD_MS) return res.status(400).json({ ok: false, error: 'Posts can be scheduled at most 90 days ahead' });

  for (const it of items) {
    if (!['facebook', 'instagram', 'linkedin'].includes(it.platform) || !it.externalId || !it.caption) {
      return res.status(400).json({ ok: false, error: 'Each item needs a valid platform, externalId and caption' });
    }
  }

  try {
    const rows = items.map((it) => ({
      platform: it.platform,
      external_id: it.externalId,
      account_name: it.accountName || null,
      caption: it.caption,
      image_url: imageUrl,
      scheduled_for: when.toISOString(),
    }));
    const created = await createScheduledPosts(rows);
    res.status(200).json({ ok: true, count: created.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
