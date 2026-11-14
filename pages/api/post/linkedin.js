import { publishToLinkedIn } from '../../../lib/publish';

// Expects JSON body: { authorUrn: string, imageUrl: string, caption: string }
// authorUrn is either the connected person's urn:li:person:... or, once approved,
// the company's urn:li:organization:... (see README on Community Management API access).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { authorUrn, imageUrl, caption } = req.body;

  if (!authorUrn || !imageUrl) {
    return res.status(400).json({ error: 'authorUrn and imageUrl are required' });
  }

  try {
    const result = await publishToLinkedIn({ authorUrn, imageUrl, caption });
    res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
