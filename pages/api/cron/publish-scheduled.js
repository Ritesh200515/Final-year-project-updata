import { claimDuePosts, finishScheduledPost } from '../../../lib/db';
import { publishTo } from '../../../lib/publish';

// Publishes every scheduled post that is due. Call it every few minutes from a scheduler
// (see README "Scheduling"). Protected by CRON_SECRET: send "Authorization: Bearer <CRON_SECRET>".
// Vercel Cron sends that header automatically when CRON_SECRET is set as an env var.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const posts = await claimDuePosts(5);
    const results = await Promise.all(
      posts.map(async (p) => {
        try {
          await publishTo({ platform: p.platform, externalId: p.external_id, imageUrl: p.image_url, caption: p.caption });
          await finishScheduledPost(p.id, { ok: true });
          return { id: p.id, ok: true };
        } catch (err) {
          await finishScheduledPost(p.id, { ok: false, error: err.message || err });
          return { id: p.id, ok: false, error: String(err.message || err) };
        }
      })
    );
    res.status(200).json({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
