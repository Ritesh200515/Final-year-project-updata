const RULES = {
  linkedin: 'professional, 2-4 sentences, achievement/context-focused tone suited to a company page audience, 3-5 hashtags mixing industry terms and branded tags',
  instagram: 'casual and energetic, 1-3 sentences, light emoji use if it genuinely fits, 8-12 hashtags mixing broad, niche, and local discovery tags',
  twitter: 'concise and punchy, caption plus hashtags must fit under 280 characters total, 2-3 hashtags only',
  facebook: 'warm and conversational, 2-3 sentences written for a community audience, 2-4 hashtags',
};

// platforms: array from ['linkedin','instagram','twitter','facebook'] — whatsapp deliberately excluded,
// there is no posting API for it, so it isn't part of the auto-post flow at all.
export async function generateCaptions({ imageBase64, mediaType, bizName, bizType, tone, photoType, platforms }) {
  const platformSpec = platforms.map(p => `"${p}": {"caption": "string", "hashtags": ["tag1", "tag2"]}`).join(', ');
  const ruleText = platforms.map(p => `- ${p}: ${RULES[p]}`).join('\n');

  const systemPrompt =
    `You write social media captions for ${bizType} companies, tailored per platform, based on a photo. ` +
    `Match the requested overall tone: ${tone}. The photo is about: ${photoType}. ` +
    `Each platform has its own house style:\n${ruleText}\n` +
    `Never reuse the exact same sentence across platforms — adapt the angle to fit each one. ` +
    `Hashtags: lowercase, no spaces, no # symbol in the JSON strings. ` +
    `Respond with ONLY valid JSON in this exact shape and nothing else, no markdown fences: {${platformSpec}}`;

  const userText = `Business: ${bizName}. Write captions for the attached photo for: ${platforms.join(', ')}.`;

  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mediaType, data: imageBase64 } },
        { text: userText },
      ],
    }],
    // Forces Gemini to return valid JSON directly — no markdown fence stripping needed
    generationConfig: { responseMimeType: 'application/json' },
  });

  // Model names change often and old ones get retired (404), so nothing is hardcoded:
  //  1. GEMINI_MODEL from .env, if you set one
  //  2. Google's "latest" aliases (always point at a current model)
  //  3. whatever Flash models Google lists as available right now
  // Temporary errors (503 "high demand", 429) are retried once per model; a retired model (404) is skipped.
  const MODELS = await candidateModels();
  const RETRYABLE = [429, 500, 502, 503, 504];
  let lastError = 'unknown error';
  const deadline = Date.now() + 60 * 1000; // never keep the user waiting more than ~60 seconds in total

  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() > deadline) break;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      let response, data;
      try {
        // 15s limit per request so one slow model can't use up the whole time budget
        response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(15000) });
        data = await response.json();
      } catch (err) {
        lastError = `${model}: ${err.message}`;
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) { lastGoodModel = model; return JSON.parse(text); }

      lastError = `${model}: ${JSON.stringify(data)}`;
      if (!RETRYABLE.includes(response.status)) break; // 404 retired model / 400 bad request: go to the next model
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error('Gemini is busy or unavailable right now. Please try again in a minute. (' + lastError.slice(0, 300) + ')');
}

let modelCache = { at: 0, list: [] };
let lastGoodModel = null; // the model that answered last time is tried first next time

// Asks Google which Flash models exist right now, newest first (cached for an hour).
async function discoverFlashModels() {
  if (Date.now() - modelCache.at < 60 * 60 * 1000 && modelCache.list.length) return modelCache.list;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${process.env.GEMINI_API_KEY}`);
    const data = await res.json();
    const version = (n) => {
      const m = n.match(/gemini-(\d+)(?:\.(\d+))?/);
      return m ? Number(m[1]) * 100 + Number(m[2] || 0) : 0;
    };
    const list = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /flash/.test(n) && !/(image|tts|live|audio|embedding|thinking|robotics|computer|native)/.test(n))
      .sort((a, b) => version(b) - version(a) || (/lite/.test(a) ? 1 : 0) - (/lite/.test(b) ? 1 : 0));
    modelCache = { at: Date.now(), list };
    return list;
  } catch {
    return [];
  }
}

async function candidateModels() {
  const discovered = await discoverFlashModels();
  // Fast, reliable models first. Preview models (often slow) only as a last resort.
  const stable = discovered.filter((n) => !/preview/.test(n));
  const previews = discovered.filter((n) => /preview/.test(n));
  const all = [
    process.env.GEMINI_MODEL,
    lastGoodModel,
    'gemini-flash-lite-latest',
    'gemini-2.5-flash',
    'gemini-flash-latest',
    ...stable.slice(0, 2),
    ...previews.slice(0, 1),
  ].filter(Boolean);
  return [...new Set(all)];
}
