// Run from the ibase-poster folder:  node check-gemini.mjs
// Checks your GEMINI_API_KEY and which Gemini models answer right now. Never prints the key.
import fs from 'fs';

let key = process.env.GEMINI_API_KEY;
if (!key && fs.existsSync('.env')) {
  const m = fs.readFileSync('.env', 'utf8').match(/^GEMINI_API_KEY=(.*)$/m);
  if (m) key = m[1].trim().replace(/^["']|["']$/g, '');
}
if (!key) { console.log('X  GEMINI_API_KEY was not found. Run this inside the ibase-poster folder, next to .env.'); process.exit(1); }
console.log(`Key found (${key.length} characters, starts with "${key.slice(0, 3)}").`);
if (/\s/.test(key)) console.log('!  The key contains a space. Remove it in .env.');

const short = (t) => String(t).replace(/\s+/g, ' ').slice(0, 220);

async function main() {
  // 1) which models does Google say are available to this key?
  let names = [];
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${key}`);
    const d = await r.json();
    if (!r.ok) { console.log(`X  List models failed (${r.status}): ${short(d?.error?.message || JSON.stringify(d))}`); }
    else {
      names = (d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
      console.log(`OK Key accepted. ${names.length} models can generate content.`);
    }
  } catch (e) { console.log('X  Could not reach Google:', e.message); return; }

  const flash = names.filter((n) => /flash/.test(n) && !/(image|tts|live|audio|embedding|robotics|computer|native)/.test(n));
  const candidates = [...new Set(['gemini-flash-latest', 'gemini-flash-lite-latest', ...flash.slice(0, 6)])];
  console.log('\nTrying a tiny request on each model (may take up to a minute):');
  for (const model of candidates) {
    const t0 = Date.now();
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the word OK.' }] }] }),
      });
      const d = await r.json();
      const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (text) console.log(`OK ${model} works (${secs}s)`);
      else console.log(`X  ${model} -> ${r.status}: ${short(d?.error?.message || JSON.stringify(d))} (${secs}s)`);
    } catch (e) { console.log(`X  ${model} -> ${e.message}`); }
  }
  console.log('\nDone. Send me this whole output (it contains no keys).');
}
main();
