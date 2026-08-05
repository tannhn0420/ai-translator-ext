// ============================================
// Page Translate — Selection (in-place translate of a highlighted passage)
// ============================================
// Reuses the full-page machinery (segmenter block detection + serialize/reconstruct
// + batch) but scoped to the block(s) a text selection overlaps. Supports replacing
// the passage in place or inserting a bilingual translation under it — both preserve
// inline formatting (bold, links, …).

import { collectBlocks } from './segmenter';
import { serializeBlock, applyTranslation } from './serialize';
import { PAGE_BATCH_MAX_ITEMS, PAGE_BATCH_MAX_CHARS } from '../../utils/constants';
import type {
  Language,
  PageTranslateMode,
  BatchTranslateItem,
  BatchTranslateResponse,
} from '../../types';

const HARD_BLOCK_CHAR_CAP = 8000;
const VI_RE =
  /[àáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳýỵỷỹ]/i;

/** Pick the target language for a passage: Vietnamese source → English, otherwise → Vietnamese. */
export function detectTarget(text: string): Language {
  return VI_RE.test(text) ? 'en' : 'vi';
}

/** Leaf blocks that the selection range overlaps. */
function blocksForRange(range: Range, targetLang: Language): HTMLElement[] {
  const node: Node = range.commonAncestorContainer;
  const container = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node) as HTMLElement | null;
  if (!container) return [];

  const all = collectBlocks(targetLang, container);
  const overlapping = all.filter((el) => {
    try {
      return range.intersectsNode(el);
    } catch {
      return false;
    }
  });
  return overlapping;
}

function chunkItems(items: BatchTranslateItem[]): BatchTranslateItem[][] {
  const batches: BatchTranslateItem[][] = [];
  let cur: BatchTranslateItem[] = [];
  let chars = 0;
  for (const it of items) {
    if (cur.length > 0 && (cur.length >= PAGE_BATCH_MAX_ITEMS || chars + it.text.length > PAGE_BATCH_MAX_CHARS)) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(it);
    chars += it.text.length;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

function applyOne(el: HTMLElement, map: Node[], translated: string, mode: PageTranslateMode): void {
  if (!el.isConnected) return;
  // Mark the source block so a later full-page translation skips it (avoids duplicates).
  el.setAttribute('data-ai-translated', '1');

  if (mode === 'bilingual') {
    const wrap = document.createElement('div');
    wrap.className = 'ai-tr-bilingual';
    wrap.setAttribute('data-ai-translated', '1');
    applyTranslation(wrap, translated, map);
    el.insertAdjacentElement('afterend', wrap);
  } else {
    applyTranslation(el, translated, map);
  }
}

export interface SelectionTranslateResult {
  ok: boolean;
  msg: string;
}

/**
 * Translate the block(s) a selection overlaps, in place. `mode` is 'replace' (overwrite)
 * or 'bilingual' (insert the translation under each block).
 */
export async function translateSelection(
  range: Range,
  mode: PageTranslateMode,
): Promise<SelectionTranslateResult> {
  const selText = range.toString();
  if (!selText.trim()) return { ok: false, msg: 'Chưa chọn nội dung.' };

  const targetLang = detectTarget(selText);
  const blocks = blocksForRange(range, targetLang);
  if (blocks.length === 0) {
    return { ok: false, msg: 'Không tìm thấy đoạn để dịch (hoặc đã ở ngôn ngữ đích).' };
  }

  const entries: { el: HTMLElement; map: Node[] }[] = [];
  const items: BatchTranslateItem[] = [];
  for (const el of blocks) {
    if (el.hasAttribute('data-ai-translated')) continue;
    const { text, map } = serializeBlock(el);
    if (!text.trim() || text.length > HARD_BLOCK_CHAR_CAP) continue;
    const i = entries.length;
    entries.push({ el, map });
    items.push({ i, text });
  }
  if (items.length === 0) return { ok: false, msg: 'Đoạn này đã được dịch rồi.' };

  let applied = 0;
  for (const batch of chunkItems(items)) {
    let data: Record<number, string> = {};
    try {
      const resp: BatchTranslateResponse = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_BATCH',
        payload: { items: batch, targetLang },
      });
      data = resp?.data || {};
    } catch {
      // leave these blocks untouched
    }
    for (const it of batch) {
      const translated = data[it.i];
      const entry = entries[it.i];
      if (entry && typeof translated === 'string' && translated.length > 0) {
        applyOne(entry.el, entry.map, translated, mode);
        applied++;
      }
    }
  }

  if (applied === 0) return { ok: false, msg: 'Dịch thất bại. Kiểm tra API key / hạn mức.' };
  return {
    ok: true,
    msg: mode === 'bilingual' ? '✅ Đã chèn bản dịch song ngữ' : '✅ Đã ghi đè bản dịch',
  };
}
