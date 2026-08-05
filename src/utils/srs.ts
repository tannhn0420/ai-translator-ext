// ============================================
// Spaced Repetition (SM-2 lite)
// ============================================

import type { VocabCard, VocabCardInput, ReviewRating } from '../types';

const DAY_MS = 86_400_000;
const AGAIN_DELAY_MS = 10 * 60 * 1000; // 10 minutes
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;

/** Build a fresh card, due immediately, with default SRS parameters. */
export function createCard(input: VocabCardInput, now: number): VocabCard {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.round(now % 1e6)}`,
    term: input.term.trim(),
    lang: input.lang,
    meaning: input.meaning.trim(),
    ipa: input.ipa,
    example: input.example,
    context: input.context,
    sourceUrl: input.sourceUrl,
    topic: input.topic,
    image: input.image,
    createdAt: now,
    due: now,
    interval: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
  };
}

/** Apply a review rating and return the updated card (new interval / ease / due). */
export function reviewCard(card: VocabCard, rating: ReviewRating, now: number): VocabCard {
  let { interval, ease, reps, lapses } = card;

  switch (rating) {
    case 'again':
      lapses += 1;
      ease = Math.max(MIN_EASE, ease - 0.2);
      interval = 0;
      reps = 0;
      break;
    case 'hard':
      ease = Math.max(MIN_EASE, ease - 0.15);
      interval = Math.max(1, Math.round((interval || 1) * 1.2));
      reps += 1;
      break;
    case 'good':
      if (reps === 0) interval = 1;
      else if (reps === 1) interval = 6;
      else interval = Math.round((interval || 1) * ease);
      reps += 1;
      break;
    case 'easy':
      ease = Math.min(MAX_EASE, ease + 0.15);
      interval = Math.max(1, Math.round((interval || 1) * ease * 1.3));
      reps += 1;
      break;
  }

  const due = rating === 'again' ? now + AGAIN_DELAY_MS : now + interval * DAY_MS;
  return { ...card, interval, ease, reps, lapses, due };
}

/** Cards whose due time has passed. */
export function getDueCards(deck: VocabCard[], now: number): VocabCard[] {
  return deck.filter((c) => c.due <= now);
}
