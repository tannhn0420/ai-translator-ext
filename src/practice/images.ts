// ============================================
// Throttled, memoized illustration loader for vocab cards.
// ============================================
//
// Vocab lists can hold ~20 words. If every card fetched its image on mount at
// once we'd fire 20 parallel requests and likely trip Openverse's rate limit.
// Instead all cards funnel through one serialized queue that spaces requests out
// (~350ms), so images load "từ từ" (gradually) as the user reads. Results are
// memoized in-session here and cached across sessions by the background handler,
// so revisiting a topic or word is instant and token/quota-free.

const memo = new Map<string, string>(); // term(lower) -> url ('' = looked up, no image)
const inflight = new Map<string, Promise<string>>();
let chain: Promise<void> = Promise.resolve();
// Spacing between network fetches. Kept modest since callers also gate loading by
// viewport visibility (IntersectionObserver), so this rarely queues more than a screenful.
const GAP_MS = 250;

function norm(term: string): string {
  return term.trim().toLowerCase();
}

/** Synchronous read of an already-resolved image, if any. `undefined` = not looked up yet. */
export function cachedImage(term: string): string | undefined {
  return memo.get(norm(term));
}

/**
 * Resolve an illustration URL for `term`. Deduplicates concurrent callers, serializes
 * network fetches with spacing, and memoizes the result (including "no image found").
 * Never rejects — resolves to '' when nothing is available.
 */
export function loadImage(term: string): Promise<string> {
  const key = norm(term);
  if (!key) return Promise.resolve('');
  if (memo.has(key)) return Promise.resolve(memo.get(key)!);

  const existing = inflight.get(key);
  if (existing) return existing;

  const p = new Promise<string>((resolve) => {
    chain = chain.then(async () => {
      if (memo.has(key)) {
        resolve(memo.get(key)!);
        return;
      }
      let url = '';
      try {
        const r = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', payload: { query: term } });
        url = r?.data?.urls?.[0] || '';
      } catch {
        url = '';
      }
      memo.set(key, url);
      inflight.delete(key);
      resolve(url);
      // Space out the *next* network fetch. Cache hits above short-circuit before this.
      await new Promise((res) => setTimeout(res, GAP_MS));
    });
  });

  inflight.set(key, p);
  return p;
}
