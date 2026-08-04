// ============================================
// Page Translate — Segmenter
// ============================================
// Walks the DOM and returns the "leaf block" elements that contain translatable
// text. A leaf block is the smallest block-level element wrapping a sentence/line;
// it never contains another selected block, so blocks never overlap (no double
// translation, no structural breakage).

import { PAGE_TRANSLATE_MAX_BLOCKS } from '../../utils/constants';
import type { Language } from '../../types';

/** Block-level tags treated as translation units. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'TD', 'TH', 'CAPTION', 'BLOCKQUOTE', 'DT', 'DD',
  'FIGCAPTION', 'SUMMARY', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'MAIN', 'NAV',
  'ADDRESS', 'LABEL', 'DIALOG',
]);

/** Subtrees we never translate (code, form controls, media, non-text). */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE',
  'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'TT',
  'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'SVG', 'CANVAS', 'IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'MATH',
]);

/** Vietnamese diacritics — presence strongly implies the text is already Vietnamese. */
const VIETNAMESE_RE =
  /[àáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳýỵỷỹ]/i;

export function isVietnamese(text: string): boolean {
  return VIETNAMESE_RE.test(text);
}

/**
 * Fraction of words carrying a Vietnamese diacritic. Distinguishes real Vietnamese
 * prose (typically 0.4–0.7) from English text that merely mentions a Vietnamese
 * proper noun like "Việt Nam", "Hà Nội", or "Hưng" (well under 0.15).
 */
function vietnameseWordRatio(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  let vi = 0;
  for (const w of words) if (VIETNAMESE_RE.test(w)) vi++;
  return vi / words.length;
}

/** A block is treated as "already Vietnamese" only if it is predominantly Vietnamese. */
const VI_DOMINANCE_THRESHOLD = 0.3;

/** True if the element (by itself) marks a subtree we must not translate. */
function isSkippedElement(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  const translate = el.getAttribute('translate');
  if (translate === 'no') return true;
  if (el.classList.contains('notranslate')) return true;
  // Our own injected UI (sidebar, bubble, icon, loaders, overlays…)
  const id = el.id;
  if (id && id.startsWith('ai-translator')) return true;
  return false;
}

function isBlockTag(el: Element): boolean {
  return BLOCK_TAGS.has(el.tagName);
}

/**
 * Climb from a text node to its nearest block ancestor. Returns null if any
 * ancestor along the way marks a skipped subtree.
 */
function nearestBlock(node: Node): HTMLElement | null {
  let el: Element | null = node.parentElement;
  while (el) {
    if (isSkippedElement(el)) return null;
    if (isBlockTag(el)) return el as HTMLElement;
    el = el.parentElement;
  }
  return null;
}

/** Text that carries no meaning to translate (whitespace, numbers, symbols, bare URLs). */
function isTranslatableText(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (!/\p{L}/u.test(t)) return false; // needs at least one letter
  if (/^[\d\s\p{P}\p{S}]+$/u.test(t)) return false; // only digits/punct/symbols
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return false; // a lone URL
  return true;
}

/** Whether a block whose combined text is `text` should be translated into `targetLang`. */
function shouldTranslateForLang(text: string, targetLang: Language): boolean {
  const ratio = vietnameseWordRatio(text);
  if (targetLang === 'vi') {
    // Translate unless the block is *predominantly* Vietnamese already. English text
    // that only mentions "Việt Nam"/"Hà Nội"/"Hưng" has a low ratio → still translated.
    return ratio < VI_DOMINANCE_THRESHOLD;
  }
  // targetLang === 'en': only translate blocks that are predominantly Vietnamese;
  // leave already-English blocks untouched.
  return ratio >= VI_DOMINANCE_THRESHOLD;
}

function isVisible(el: HTMLElement): boolean {
  // Cheap-ish visibility gate: skip elements not rendered (display:none, detached…).
  return el.getClientRects().length > 0;
}

/**
 * Collect the leaf block elements under `root` that hold translatable text for `targetLang`,
 * in document order. Blocks are guaranteed not to be ancestors of one another.
 */
export function collectBlocks(
  targetLang: Language,
  root: HTMLElement = document.body,
): HTMLElement[] {
  if (!root) return [];

  const blocks = new Set<HTMLElement>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  let node: Node | null = walker.nextNode();
  while (node) {
    const text = node.nodeValue || '';
    if (isTranslatableText(text)) {
      const block = nearestBlock(node);
      if (block) blocks.add(block);
    }
    node = walker.nextNode();
  }

  // Drop any block that is an ancestor of another collected block (keep leaf-most).
  const toRemove = new Set<HTMLElement>();
  for (const b of blocks) {
    let a: HTMLElement | null = b.parentElement;
    while (a) {
      if (blocks.has(a)) toRemove.add(a);
      a = a.parentElement;
    }
  }

  const leaves: HTMLElement[] = [];
  for (const b of blocks) {
    if (toRemove.has(b)) continue;
    if (b.hasAttribute('data-ai-translated')) continue;
    if (!isVisible(b)) continue;
    // Final language gate on the block's own combined text.
    if (!shouldTranslateForLang(b.textContent || '', targetLang)) continue;
    leaves.push(b);
    if (leaves.length >= PAGE_TRANSLATE_MAX_BLOCKS) break;
  }

  leaves.sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );

  return leaves;
}
