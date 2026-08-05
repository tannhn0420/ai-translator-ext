// ============================================
// Flashcards helpers — import/export + image downscale
// ============================================

import type { VocabCard, VocabCardInput, Language } from '../types';

const VI_RE =
  /[àáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳýỵỷỹ]/i;

export function detectLang(s: string): Language {
  return VI_RE.test(s) ? 'vi' : 'en';
}

// ---- Image → small thumbnail (keeps storage tiny; never sent to the model) ----

export function fileToThumbnail(file: File, max = 240, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('no canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ---- Export ----

function csvEscape(s: string): string {
  const v = (s || '').replace(/\r?\n/g, ' ');
  return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCSV(deck: VocabCard[]): string {
  const header = 'term,meaning,ipa,example,topic,lang';
  const rows = deck.map((c) =>
    [c.term, c.meaning, c.ipa || '', c.example || '', c.topic || '', c.lang].map(csvEscape).join(','),
  );
  return [header, ...rows].join('\n');
}

export function toTSV(deck: VocabCard[]): string {
  return deck
    .map((c) => {
      const back = [c.meaning, c.ipa ? `/${c.ipa.replace(/^\/|\/$/g, '')}/` : '', c.example]
        .filter(Boolean)
        .join('  ·  ')
        .replace(/\t/g, ' ');
      return `${c.term.replace(/\t/g, ' ')}\t${back}`;
    })
    .join('\n');
}

export function toJSON(deck: VocabCard[]): string {
  return JSON.stringify(deck, null, 2);
}

export function download(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Import ----

function parseDelimLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const KNOWN_COLS = ['term', 'meaning', 'ipa', 'example', 'topic', 'lang'];

/**
 * Parse an imported file into card-shaped objects. JSON files (backups) keep their
 * full shape incl. SRS + id; CSV/TSV produce fresh inputs. Background decides which
 * to restore vs. create.
 */
export function parseImport(filename: string, text: string): Array<VocabCardInput | VocabCard> {
  const lower = filename.toLowerCase();
  const trimmed = text.trim();

  if (lower.endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
      const arr: unknown[] = Array.isArray(data)
        ? data
        : (data.cards as unknown[]) || (data.deck as unknown[]) || [];
      return arr
        .map((r) => {
          const it = r as Partial<VocabCard>;
          if (!it || !it.term) return null;
          const lang: Language = it.lang === 'en' || it.lang === 'vi' ? it.lang : detectLang(it.term);
          return { ...it, term: it.term, meaning: it.meaning || '', lang } as VocabCardInput | VocabCard;
        })
        .filter(Boolean) as Array<VocabCardInput | VocabCard>;
    } catch {
      // fall through to delimited parsing
    }
  }

  const delim = lower.endsWith('.tsv') || (!lower.endsWith('.csv') && text.includes('\t')) ? '\t' : ',';
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  const firstCols = parseDelimLine(lines[0], delim).map((h) => h.trim().toLowerCase());
  const hasHeader = firstCols.some((h) => KNOWN_COLS.includes(h));
  const cols = hasHeader ? firstCols : KNOWN_COLS;
  const rows = hasHeader ? lines.slice(1) : lines;

  const cards: VocabCardInput[] = [];
  for (const line of rows) {
    const vals = parseDelimLine(line, delim);
    const rec: Record<string, string> = {};
    cols.forEach((c, i) => {
      rec[c] = (vals[i] || '').trim();
    });
    const term = rec.term;
    if (!term) continue;
    const lang: Language = rec.lang === 'en' || rec.lang === 'vi' ? rec.lang : detectLang(term);
    cards.push({
      term,
      meaning: rec.meaning || '',
      ipa: rec.ipa || undefined,
      example: rec.example || undefined,
      topic: rec.topic || undefined,
      lang,
    });
  }
  return cards;
}
