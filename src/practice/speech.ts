// ============================================
// Speech helpers — recognition (speaking) + scoring
// ============================================

/* eslint-disable @typescript-eslint/no-explicit-any */

export function isSpeechRecognitionSupported(): boolean {
  return typeof (window as any).SpeechRecognition !== 'undefined' ||
    typeof (window as any).webkitSpeechRecognition !== 'undefined';
}

export interface RecognitionHandle {
  stop: () => void;
}

/**
 * Recognize a single utterance. Calls onPartial with live text, resolves with the
 * final transcript on end, rejects on error/unsupported.
 */
export function recognizeOnce(
  lang: string,
  onPartial: (text: string) => void,
): { promise: Promise<string>; handle: RecognitionHandle } {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) {
    return {
      promise: Promise.reject(new Error('unsupported')),
      handle: { stop: () => {} },
    };
  }

  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;

  let finalText = '';
  const promise = new Promise<string>((resolve, reject) => {
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onPartial((finalText + interim).trim());
    };
    rec.onerror = (e: any) => reject(new Error(e.error || 'error'));
    rec.onend = () => resolve(finalText.trim());
    try {
      rec.start();
    } catch (err) {
      reject(err as Error);
    }
  });

  return { promise, handle: { stop: () => { try { rec.stop(); } catch { /* noop */ } } } };
}

export interface ScoredToken {
  w: string;
  ok: boolean;
}

export interface SpeechScore {
  score: number; // 0-100
  tokens: ScoredToken[]; // target words with match flags
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Compare spoken text against the target by word multiset; flag each target word. */
export function scoreSpeech(target: string, said: string): SpeechScore {
  const targetWords = tokenize(target);
  const pool = tokenize(said);
  const tokens: ScoredToken[] = targetWords.map((w) => {
    const idx = pool.indexOf(w);
    if (idx >= 0) {
      pool.splice(idx, 1);
      return { w, ok: true };
    }
    return { w, ok: false };
  });
  const okCount = tokens.filter((t) => t.ok).length;
  const score = targetWords.length ? Math.round((okCount / targetWords.length) * 100) : 0;
  return { score, tokens };
}
