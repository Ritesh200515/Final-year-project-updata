import { deleteConnectedAccount } from '../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { platform, externalId } = req.body || {};
  if (!platform || !externalId) {
    return res.status(400).json({ ok: false, error: 'platform and externalId are required' });
  }

  try {
    await deleteConnectedAccount(platform, externalId);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Disconnect error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
