// ============================================
// Dictation source parsing + sentence splitting.
// ============================================
// Accepts plain text, an SRT / WebVTT subtitle file, or a pasted YouTube
// transcript, and returns clean prose split into typeable sentences.

const TIMESTAMP_RE = /\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}/;
const CUE_INDEX_RE = /^\d+$/;
const YT_TIME_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/; // "0:12" / "1:02:33" lines in YouTube transcripts

/** Strip subtitle/transcript scaffolding (timestamps, cue numbers, tags) → clean prose. */
export function parseSource(raw: string): string {
  const text = (raw || '').replace(/\r/g, '');
  const out: string[] = [];
  for (let line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (t === 'WEBVTT' || t.startsWith('WEBVTT')) continue;
    if (TIMESTAMP_RE.test(t)) continue;
    if (CUE_INDEX_RE.test(t)) continue;
    if (YT_TIME_RE.test(t)) continue;
    line = line.replace(/<[^>]+>/g, ''); // inline VTT/HTML tags
    if (line.trim()) out.push(line.trim());
  }
  // De-duplicate consecutive identical lines (rolling captions repeat a lot).
  const deduped: string[] = [];
  for (const l of out) {
    if (deduped[deduped.length - 1] !== l) deduped.push(l);
  }
  return deduped.join(' ').replace(/\s+/g, ' ').trim();
}

/** Split prose into sentences; break over-long sentences at commas to keep units typeable. */
export function splitSentences(text: string): string[] {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.match(/[^.!?]+[.!?]+["'’)\]]*|\S[^.!?]*$/g) || [clean];
  const result: string[] = [];
  for (const raw of parts.map((s) => s.trim()).filter(Boolean)) {
    if (raw.length <= 180) {
      result.push(raw);
      continue;
    }
    let chunk = '';
    for (const piece of raw.split(/(,\s+)/)) {
      if ((chunk + piece).length > 180 && chunk.trim()) {
        result.push(chunk.trim());
        chunk = piece;
      } else {
        chunk += piece;
      }
    }
    if (chunk.trim()) result.push(chunk.trim());
  }
  return result;
}
