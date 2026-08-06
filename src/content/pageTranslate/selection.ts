// ============================================
// Page Translate — Selection (in-place translate of a highlighted passage)
// ============================================
// Reuses the full-page machinery (segmenter block detection + serialize/reconstruct
// + batch) but scoped to the block(s) a text selection overlaps. Supports replacing
// the passage in place or inserting a bilingual translation under it — both preserve
// inline formatting (bold, links, …).

import { collectBlocks, nearestBlockAncestor } from './segmenter';
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

/** Reliable "does this element's content overlap the range?" test (compareBoundaryPoints
 *  is far more dependable across engines than Range.intersectsNode). */
function overlapsRange(range: Range, el: HTMLElement): boolean {
  try {
    const elRange = el.ownerDocument.createRange();
    elRange.selectNodeContents(el);
    // Overlap iff range.start < el.end AND range.end > el.start.
    return (
      range.compareBoundaryPoints(Range.START_TO_END, elRange) > 0 &&
      range.compareBoundaryPoints(Range.END_TO_START, elRange) < 0
    );
  } catch {
    return false;
  }
}

/** Leaf blocks that the selection range overlaps. Anchors on the start/end blocks so a
 *  selection is always resolvable, even for a partial highlight inside one paragraph. */
function blocksForRange(range: Range, targetLang: Language): HTMLElement[] {
  const startBlock = nearestBlockAncestor(range.startContainer);
  const endBlock = nearestBlockAncestor(range.endContainer);

  const node: Node = range.commonAncestorContainer;
  const container = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node) as HTMLElement | null;

  const seen = new Set<HTMLElement>();
  const out: HTMLElement[] = [];
  const add = (el: HTMLElement | null) => {
    if (el && el.isConnected && !seen.has(el)) {
      seen.add(el);
      out.push(el);
    }
  };

  // The block where the selection begins is always a candidate.
  add(startBlock);

  // Middle blocks: collect leaf blocks in the common ancestor (language-agnostic — the
  // user explicitly chose this passage) and keep those the range actually overlaps.
  if (container && startBlock !== endBlock) {
    for (const el of collectBlocks(targetLang, container, { ignoreLangGate: true })) {
      if (overlapsRange(range, el)) add(el);
    }
  }

  // …and the block where it ends.
  add(endBlock);

  out.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return out;
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
