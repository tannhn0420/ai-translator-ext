// ============================================
// Page Translate — Serialize / Reconstruct
// ============================================
// Turns a block's inline content into a token string the model can translate
// while preserving formatting, then rebuilds the DOM from the translated string.
//
//   Original :  The <b>quick</b> fox <a href=x>jumps</a><br>now.
//   Serialized: The <0>quick</0> fox <1>jumps</1><2/>now.
//   Translated: Con cáo <1>nhảy</1> <0>nhanh</0><2/>bây giờ.
//   Rebuilt  :  <b> and <a> reinstated (attributes intact) around the new words.

/** Inline elements whose TEXT must not be translated but must be preserved verbatim. */
const OPAQUE_TAGS = new Set([
  'CODE', 'KBD', 'SAMP', 'VAR', 'TT', 'PRE',
  'IMG', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'MATH',
  'BR', 'HR', 'WBR', 'INPUT', 'SCRIPT', 'STYLE', 'NOSCRIPT',
]);

export interface SerializedBlock {
  /** Token string sent to the model. */
  text: string;
  /**
   * Clones of the inline elements, indexed by token number.
   * Wrappers are shallow clones (attributes only); opaque/void nodes are deep clones.
   */
  map: Node[];
}

const TOKEN_RE = /<(\/?)(\d+)(\/?)>/g;

function serializeChildren(parent: Node, map: Node[]): string {
  let out = '';
  parent.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.nodeValue || '';
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;

    const el = child as HTMLElement;
    const opaque = OPAQUE_TAGS.has(el.tagName);
    const empty = el.childNodes.length === 0;

    if (opaque || empty) {
      // Preserve the whole node as a void token; do not translate its contents.
      const n = map.length;
      map.push(el.cloneNode(true));
      out += `<${n}/>`;
    } else {
      // Wrapper: keep attributes (shallow clone), translate the inner text.
      const n = map.length;
      map.push(el.cloneNode(false));
      out += `<${n}>${serializeChildren(el, map)}</${n}>`;
    }
  });
  return out;
}

/** Serialize a block's inline content into a token string + element map. */
export function serializeBlock(el: HTMLElement): SerializedBlock {
  const map: Node[] = [];
  const text = serializeChildren(el, map);
  return { text, map };
}

/** Remove all inline tokens, leaving plain translated text. */
export function stripTokens(s: string): string {
  return s.replace(TOKEN_RE, '');
}

/**
 * Rebuild a DocumentFragment from a translated token string.
 * Returns null if the tokens are unbalanced (caller should fall back to plain text).
 */
function buildFragment(s: string, map: Node[]): DocumentFragment | null {
  const frag = document.createDocumentFragment();
  const stack: Node[] = [frag];
  const top = () => stack[stack.length - 1];
  const appendText = (txt: string) => {
    if (txt) top().appendChild(document.createTextNode(txt));
  };

  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;

  while ((m = TOKEN_RE.exec(s))) {
    const [full, closeSlash, numStr, selfSlash] = m;
    const n = Number(numStr);

    if (m.index > last) appendText(s.slice(last, m.index));
    last = TOKEN_RE.lastIndex;

    // Out-of-range index → not a real token; keep the literal text (e.g. "a<3>b").
    if (n < 0 || n >= map.length) {
      appendText(full);
      continue;
    }

    if (selfSlash) {
      top().appendChild(map[n].cloneNode(true));
    } else if (closeSlash) {
      if (stack.length <= 1) return null; // unbalanced close
      stack.pop();
    } else {
      const clone = map[n].cloneNode(true);
      top().appendChild(clone);
      stack.push(clone);
    }
  }

  if (last < s.length) appendText(s.slice(last));
  if (stack.length !== 1) return null; // unclosed tags
  return frag;
}

/**
 * Apply a translated token string to `el`, replacing its children.
 * Uses inline reconstruction when the tokens are valid, otherwise falls back to
 * a single plain-text node (block structure preserved, inline formatting dropped
 * for that one block). Returns true if inline formatting was preserved.
 */
export function applyTranslation(el: HTMLElement, translated: string, map: Node[]): boolean {
  const frag = buildFragment(translated, map);
  if (frag) {
    el.replaceChildren(frag);
    return true;
  }
  el.textContent = stripTokens(translated);
  return false;
}
