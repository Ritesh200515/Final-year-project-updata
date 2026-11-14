import { publishToMeta } from '../../../lib/publish';

// Expects JSON body: { platform: 'facebook' | 'instagram', pageId: string, imageUrl: string, caption: string }
// imageUrl must be a publicly reachable URL (Graph API fetches it server-side).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { platform, pageId, imageUrl, caption } = req.body;

  if (!['facebook', 'instagram'].includes(platform)) {
    return res.status(400).json({ error: 'platform must be facebook or instagram' });
  }
  if (!pageId || !imageUrl) {
    return res.status(400).json({ error: 'pageId and imageUrl are required' });
  }

  try {
    const result = await publishToMeta({ platform, pageId, imageUrl, caption });
    res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
