// ============================================
// TTS voice selection — prefer natural / neural system voices.
// ============================================
// Browsers ship a mix of robotic and high-quality voices. On Windows the neural
// ones are named like "Microsoft Aria Online (Natural)"; Chrome also exposes
// "Google …" voices. This ranks voices so we auto-pick a natural one when the
// user hasn't chosen a specific voice.

export function isNaturalVoice(v: SpeechSynthesisVoice): boolean {
  return /natural|neural|online|google|wavenet/i.test(v.name);
}

function score(v: SpeechSynthesisVoice, lang: 'en' | 'vi'): number {
  const name = v.name.toLowerCase();
  let s = 0;
  if ((v.lang || '').toLowerCase().startsWith(lang)) s += 100;
  if (/natural|neural/.test(name)) s += 50;
  if (/wavenet/.test(name)) s += 45;
  if (/online/.test(name)) s += 25;
  if (/google/.test(name)) s += 20;
  if (/microsoft/.test(name)) s += 6;
  // For English prefer common accents slightly.
  if (lang === 'en' && /(en-us|en-gb)/i.test(v.lang || '')) s += 3;
  return s;
}

/** Choose the voice to speak with: the user's pick if present, else the best natural one. */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: 'en' | 'vi',
  preferredURI?: string,
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;
  if (preferredURI) {
    const exact = voices.find((v) => v.voiceURI === preferredURI);
    if (exact) return exact;
  }
  const matching = voices.filter((v) => (v.lang || '').toLowerCase().startsWith(lang));
  const pool = matching.length ? matching : voices;
  return pool.slice().sort((a, b) => score(b, lang) - score(a, lang))[0] || null;
}

/** Order voices for a picker dropdown: natural ones first, then by name. */
export function sortedVoices(voices: SpeechSynthesisVoice[], lang?: 'en' | 'vi'): SpeechSynthesisVoice[] {
  return voices.slice().sort((a, b) => {
    if (lang) {
      const la = (a.lang || '').toLowerCase().startsWith(lang) ? 1 : 0;
      const lb = (b.lang || '').toLowerCase().startsWith(lang) ? 1 : 0;
      if (la !== lb) return lb - la;
    }
    const na = isNaturalVoice(a) ? 1 : 0;
    const nb = isNaturalVoice(b) ? 1 : 0;
    if (na !== nb) return nb - na;
    return a.name.localeCompare(b.name);
  });
}
