import { generateCaptions } from '../../lib/gemini';

// Expects JSON body: { imageBase64, mediaType, bizName, bizType, tone, photoType, platforms }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { imageBase64, mediaType, bizName, bizType, tone, photoType, platforms } = req.body;

  if (!imageBase64 || !platforms || !platforms.length) {
    return res.status(400).json({ error: 'imageBase64 and platforms are required' });
  }

  try {
    const result = await generateCaptions({
      imageBase64,
      mediaType: mediaType || 'image/jpeg',
      bizName: bizName || 'iBase Electrosoft LLP',
      bizType: bizType || 'IT training & placement institute',
      tone: tone || 'professional and encouraging',
      photoType: photoType || 'general institute activity',
      platforms,
    });
    res.status(200).json({ ok: true, captions: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
