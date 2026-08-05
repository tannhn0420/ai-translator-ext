// ============================================
// Flashcards — full-screen vocabulary review & management
// ============================================

import { useEffect, useMemo, useState } from 'react';
import type { VocabCard, ReviewRating } from '../types';
import { reviewCard, getDueCards } from '../utils/srs';

type Tab = 'review' | 'manage';

const RATINGS: { key: ReviewRating; label: string; cls: string }[] = [
  { key: 'again', label: 'Quên (Again)', cls: 'again' },
  { key: 'hard', label: 'Khó (Hard)', cls: 'hard' },
  { key: 'good', label: 'Được (Good)', cls: 'good' },
  { key: 'easy', label: 'Dễ (Easy)', cls: 'easy' },
];

function formatDue(due: number, now: number): string {
  const diff = due - now;
  if (diff <= 0) return 'đến hạn';
  const days = Math.round(diff / 86_400_000);
  if (days >= 1) return `sau ${days} ngày`;
  const mins = Math.round(diff / 60_000);
  if (mins >= 60) return `sau ${Math.round(mins / 60)} giờ`;
  return `sau ${mins} phút`;
}

export default function FlashcardsApp() {
  const [deck, setDeck] = useState<VocabCard[]>([]);
  const [tab, setTab] = useState<Tab>('review');
  const [loading, setLoading] = useState(true);
  const [flipped, setFlipped] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_VOCAB' });
      setDeck((res?.data as VocabCard[]) || []);
    } catch {
      setDeck([]);
    }
    setLoading(false);
  }

  const now = Date.now();
  const due = useMemo(
    () => getDueCards(deck, Date.now()).sort((a, b) => a.due - b.due),
    [deck],
  );
  const current = due[0];

  const stats = useMemo(() => {
    const n = Date.now();
    return {
      total: deck.length,
      due: getDueCards(deck, n).length,
      learned: deck.filter((c) => c.reps >= 2).length,
    };
  }, [deck]);

  async function rate(rating: ReviewRating) {
    if (!current) return;
    const updated = reviewCard(current, rating, Date.now());
    setDeck((d) => d.map((c) => (c.id === updated.id ? updated : c)));
    setFlipped(false);
    try {
      await chrome.runtime.sendMessage({ type: 'UPDATE_VOCAB', payload: { card: updated } });
    } catch {
      /* keep local state; will resync on next load */
    }
  }

  async function del(id: string) {
    setDeck((d) => d.filter((c) => c.id !== id));
    try {
      await chrome.runtime.sendMessage({ type: 'DELETE_VOCAB', payload: { id } });
    } catch {
      /* ignore */
    }
  }

  function exportTSV() {
    const esc = (s: string | undefined) => (s || '').replace(/[\t\n\r]+/g, ' ').trim();
    const lines = deck.map((c) => {
      const back = [c.meaning, c.ipa ? `/${c.ipa.replace(/^\/|\/$/g, '')}/` : '', c.example]
        .filter(Boolean)
        .map(esc)
        .join('  ·  ');
      return `${esc(c.term)}\t${back}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ai-translator-vocab.tsv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? deck.filter((c) => c.term.toLowerCase().includes(q) || c.meaning.toLowerCase().includes(q))
      : deck;
    return [...list].sort((a, b) => b.createdAt - a.createdAt);
  }, [deck, query]);

  return (
    <div className="fc-app">
      <header className="fc-header">
        <div className="fc-title">
          <span className="fc-logo">📇</span>
          <h1>Sổ từ vựng</h1>
        </div>
        <div className="fc-stats">
          <span><b>{stats.total}</b> từ</span>
          <span className="fc-due"><b>{stats.due}</b> đến hạn</span>
          <span><b>{stats.learned}</b> đã thuộc</span>
        </div>
      </header>

      <nav className="fc-tabs">
        <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
          🎯 Ôn tập {stats.due > 0 && <span className="fc-badge">{stats.due}</span>}
        </button>
        <button className={tab === 'manage' ? 'active' : ''} onClick={() => setTab('manage')}>
          📚 Danh sách ({stats.total})
        </button>
      </nav>

      {loading ? (
        <div className="fc-empty">Đang tải…</div>
      ) : tab === 'review' ? (
        <section className="fc-review">
          {!current ? (
            <div className="fc-empty">
              <div className="fc-empty-emoji">🎉</div>
              <p>Không còn thẻ đến hạn. Quay lại sau nhé!</p>
              {deck.length === 0 && (
                <p className="fc-hint">
                  Bôi đen 1 từ trên trang web → tra từ điển → bấm <b>📇 Lưu từ</b> để thêm thẻ.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="fc-progress">Còn {due.length} thẻ đến hạn</div>
              <div className={`fc-card ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((f) => !f)}>
                <div className="fc-card-term">{current.term}</div>
                {current.ipa && <div className="fc-card-ipa">/{current.ipa.replace(/^\/|\/$/g, '')}/</div>}
                {flipped ? (
                  <div className="fc-card-back">
                    <div className="fc-card-meaning">{current.meaning}</div>
                    {current.example && <div className="fc-card-example">“{current.example}”</div>}
                  </div>
                ) : (
                  <div className="fc-card-hint">Bấm để lật 🔁</div>
                )}
              </div>

              {flipped ? (
                <div className="fc-ratings">
                  {RATINGS.map((r) => (
                    <button key={r.key} className={`fc-rate ${r.cls}`} onClick={() => rate(r.key)}>
                      {r.label}
                    </button>
                  ))}
                </div>
              ) : (
                <button className="fc-flip" onClick={() => setFlipped(true)}>
                  Hiện nghĩa
                </button>
              )}
            </>
          )}
        </section>
      ) : (
        <section className="fc-manage">
          <div className="fc-toolbar">
            <input
              className="fc-search"
              placeholder="🔍 Tìm từ / nghĩa…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="fc-export" onClick={exportTSV} disabled={deck.length === 0}>
              ⬇️ Export Anki (TSV)
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="fc-empty">{deck.length === 0 ? 'Chưa có từ nào.' : 'Không tìm thấy.'}</div>
          ) : (
            <ul className="fc-list">
              {filtered.map((c) => (
                <li key={c.id} className="fc-item">
                  <div className="fc-item-main">
                    <div className="fc-item-term">
                      {c.term}
                      {c.ipa && <span className="fc-item-ipa"> /{c.ipa.replace(/^\/|\/$/g, '')}/</span>}
                    </div>
                    <div className="fc-item-meaning">{c.meaning}</div>
                    {c.example && <div className="fc-item-example">“{c.example}”</div>}
                  </div>
                  <div className="fc-item-side">
                    <span className="fc-item-due">{formatDue(c.due, now)}</span>
                    <button className="fc-del" title="Xoá" onClick={() => del(c.id)}>
                      🗑️
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
