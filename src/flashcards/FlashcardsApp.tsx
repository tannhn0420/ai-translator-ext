// ============================================
// Flashcards — full-screen vocabulary learning hub
// ============================================

import { useEffect, useMemo, useRef, useState } from 'react';
import type { VocabCard, ReviewRating, Language } from '../types';
import { reviewCard, getDueCards } from '../utils/srs';
import { fileToThumbnail, parseImport, toCSV, toTSV, toJSON, download, detectLang } from './lib';

type Tab = 'review' | 'quiz' | 'manage' | 'add';

interface QuizQ {
  card: VocabCard;
  options: string[];
  correct: number;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Build a multiple-choice quiz: show a term, pick its meaning among distractors. */
function buildQuiz(deck: VocabCard[], n = 10): QuizQ[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const cards = deck.filter((c) => c.term.trim() && c.meaning.trim());
  if (cards.length < 4) return [];
  return shuffle(cards)
    .slice(0, Math.min(n, cards.length))
    .map((card) => {
      const seen = new Set([norm(card.meaning)]);
      const distractors: string[] = [];
      for (const o of shuffle(cards)) {
        if (o.id === card.id) continue;
        const k = norm(o.meaning);
        if (seen.has(k)) continue;
        seen.add(k);
        distractors.push(o.meaning);
        if (distractors.length === 3) break;
      }
      const options = shuffle([card.meaning, ...distractors]);
      return { card, options, correct: options.indexOf(card.meaning) };
    });
}
type ReviewMode = 'due' | 'all' | 'learned';

const DEFAULT_TOPIC = 'Chung';

const RATINGS: { key: ReviewRating; label: string; cls: string }[] = [
  { key: 'again', label: 'Quên', cls: 'again' },
  { key: 'hard', label: 'Khó', cls: 'hard' },
  { key: 'good', label: 'Được', cls: 'good' },
  { key: 'easy', label: 'Dễ', cls: 'easy' },
];

const REVIEW_MODES: { key: ReviewMode; label: string }[] = [
  { key: 'due', label: 'Đến hạn' },
  { key: 'all', label: 'Tất cả' },
  { key: 'learned', label: 'Đã thuộc' },
];

interface FormState {
  id?: string;
  term: string;
  meaning: string;
  ipa: string;
  example: string;
  topic: string;
  image?: string;
}

const emptyForm: FormState = { term: '', meaning: '', ipa: '', example: '', topic: '', image: undefined };

function formatDue(due: number, now: number): string {
  const diff = due - now;
  if (diff <= 0) return 'đến hạn';
  const days = Math.round(diff / 86_400_000);
  if (days >= 1) return `sau ${days}n`;
  const mins = Math.round(diff / 60_000);
  if (mins >= 60) return `sau ${Math.round(mins / 60)}h`;
  return `sau ${mins}p`;
}

export default function FlashcardsApp() {
  const [deck, setDeck] = useState<VocabCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('review');

  const [reviewMode, setReviewMode] = useState<ReviewMode>('due');
  const [topicFilter, setTopicFilter] = useState('');
  const [session, setSession] = useState<VocabCard[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // Quiz
  const [quiz, setQuiz] = useState<QuizQ[]>([]);
  const [qIdx, setQIdx] = useState(0);
  const [qPicked, setQPicked] = useState<number | null>(null);
  const [qScore, setQScore] = useState(0);

  const [query, setQuery] = useState('');
  const [form, setForm] = useState<FormState>(emptyForm);
  const [msg, setMsg] = useState('');
  const [findingImg, setFindingImg] = useState(false);
  const [imgChoices, setImgChoices] = useState<string[]>([]);
  const [autoImgOn, setAutoImgOn] = useState(true);

  // TTS
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsVoiceEn, setTtsVoiceEn] = useState('');
  const [ttsVoiceVi, setTtsVoiceVi] = useState('');
  const [ttsRate, setTtsRate] = useState(0.95);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const loadVoices = () => setVoices(window.speechSynthesis?.getVoices() || []);
    loadVoices();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_VOCAB' });
      setDeck((res?.data as VocabCard[]) || []);
    } catch {
      setDeck([]);
    }
    try {
      const s = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (s?.data) {
        setTtsVoiceEn(s.data.ttsVoiceEn || '');
        setTtsVoiceVi(s.data.ttsVoiceVi || '');
        setTtsRate(s.data.ttsRate || 0.95);
        const th = s.data.theme === 'light' ? 'light' : 'dark';
        setTheme(th);
        document.documentElement.dataset.theme = th;
        setAutoImgOn(s.data.vocabAutoImage !== false);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }

  const topics = useMemo(() => {
    const set = new Set<string>();
    deck.forEach((c) => set.add(c.topic || DEFAULT_TOPIC));
    return Array.from(set).sort();
  }, [deck]);

  const stats = useMemo(() => {
    const n = Date.now();
    return {
      total: deck.length,
      due: getDueCards(deck, n).length,
      learned: deck.filter((c) => c.reps >= 2).length,
    };
  }, [deck]);

  // Rebuild the review session when the mode / topic / deck size changes (not on rating).
  useEffect(() => {
    if (tab !== 'review') return;
    const now = Date.now();
    let list = deck.filter((c) => !topicFilter || (c.topic || DEFAULT_TOPIC) === topicFilter);
    if (reviewMode === 'due') list = list.filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
    else if (reviewMode === 'learned') list = list.filter((c) => c.reps >= 2);
    setSession(list);
    setIdx(0);
    setFlipped(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewMode, topicFilter, tab, deck.length]);

  const current = session[idx];

  function speak(text: string, lang: Language) {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const uri = lang === 'vi' ? ttsVoiceVi : ttsVoiceEn;
    const v = voices.find((x) => x.voiceURI === uri);
    if (v) u.voice = v;
    else u.lang = lang === 'vi' ? 'vi-VN' : 'en-US';
    u.rate = ttsRate || 0.95;
    window.speechSynthesis.speak(u);
  }

  function startQuiz() {
    const pool = topicFilter ? deck.filter((c) => (c.topic || DEFAULT_TOPIC) === topicFilter) : deck;
    setQuiz(buildQuiz(pool));
    setQIdx(0);
    setQPicked(null);
    setQScore(0);
  }

  function pickQuiz(i: number) {
    if (qPicked !== null) return;
    setQPicked(i);
    if (i === quiz[qIdx].correct) setQScore((s) => s + 1);
    speak(quiz[qIdx].card.term, quiz[qIdx].card.lang);
  }

  function nextQuiz() {
    setQPicked(null);
    setQIdx((i) => i + 1);
  }

  async function saveTts(patch: Partial<{ ttsVoiceEn: string; ttsVoiceVi: string; ttsRate: number }>) {
    try {
      await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: patch });
    } catch {
      /* ignore */
    }
  }

  async function rate(rating: ReviewRating) {
    if (!current) return;
    const updated = reviewCard(current, rating, Date.now());
    setDeck((d) => d.map((c) => (c.id === updated.id ? updated : c)));
    setSession((s) => s.map((c) => (c.id === updated.id ? updated : c)));
    setFlipped(false);
    setIdx((i) => i + 1);
    try {
      await chrome.runtime.sendMessage({ type: 'UPDATE_VOCAB', payload: { card: updated } });
    } catch {
      /* keep local state */
    }
  }

  function skipCard() {
    setFlipped(false);
    setIdx((i) => i + 1);
  }

  async function del(id: string) {
    setDeck((d) => d.filter((c) => c.id !== id));
    try {
      await chrome.runtime.sendMessage({ type: 'DELETE_VOCAB', payload: { id } });
    } catch {
      /* ignore */
    }
  }

  async function updateTopic(card: VocabCard, topic: string) {
    const updated = { ...card, topic };
    setDeck((d) => d.map((c) => (c.id === card.id ? updated : c)));
    try {
      await chrome.runtime.sendMessage({ type: 'UPDATE_VOCAB', payload: { card: updated } });
    } catch {
      /* ignore */
    }
  }

  async function saveForm() {
    if (!form.term.trim() || !form.meaning.trim()) {
      setMsg('Cần nhập từ và nghĩa.');
      return;
    }
    const lang = detectLang(form.term);
    const topic = form.topic.trim() || DEFAULT_TOPIC;
    if (form.id) {
      const existing = deck.find((c) => c.id === form.id);
      if (existing) {
        const updated: VocabCard = {
          ...existing,
          term: form.term.trim(),
          meaning: form.meaning.trim(),
          ipa: form.ipa.trim() || undefined,
          example: form.example.trim() || undefined,
          topic,
          image: form.image,
          lang,
        };
        setDeck((d) => d.map((c) => (c.id === updated.id ? updated : c)));
        await chrome.runtime.sendMessage({ type: 'UPDATE_VOCAB', payload: { card: updated } });
      }
    } else {
      await chrome.runtime.sendMessage({
        type: 'SAVE_VOCAB',
        payload: {
          term: form.term.trim(),
          meaning: form.meaning.trim(),
          ipa: form.ipa.trim() || undefined,
          example: form.example.trim() || undefined,
          topic,
          image: form.image,
          lang,
        },
      });
      await load();
    }
    setForm(emptyForm);
    setTab('manage');
  }

  function editCard(c: VocabCard) {
    setForm({
      id: c.id,
      term: c.term,
      meaning: c.meaning,
      ipa: c.ipa || '',
      example: c.example || '',
      topic: c.topic || '',
      image: c.image,
    });
    setTab('add');
  }

  async function onImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const thumb = await fileToThumbnail(file);
      setForm((f) => ({ ...f, image: thumb }));
    } catch {
      setMsg('Không đọc được ảnh.');
    }
    e.target.value = '';
  }

  async function autoImage() {
    const term = form.term.trim();
    if (!term || findingImg) return;
    setFindingImg(true);
    setMsg('');
    setImgChoices([]);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', payload: { query: term } });
      const urls = res?.data?.urls as string[] | undefined;
      if (urls?.length) {
        setImgChoices(urls);
        setForm((f) => ({ ...f, image: urls[0] }));
      } else {
        setMsg(res?.error || 'Không tìm được ảnh.');
      }
    } catch {
      setMsg('Lỗi tìm ảnh.');
    }
    setFindingImg(false);
  }

  function toggleAutoImg() {
    const next = !autoImgOn;
    setAutoImgOn(next);
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: { vocabAutoImage: next } }).catch(() => {});
  }

  async function onImportPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const cards = parseImport(file.name, text);
      if (cards.length === 0) {
        setMsg('Không tìm thấy thẻ hợp lệ trong file.');
      } else {
        const res = await chrome.runtime.sendMessage({ type: 'IMPORT_VOCAB', payload: { cards } });
        const d = res?.data || { added: 0, skipped: 0 };
        setMsg(`Đã nhập ${d.added} thẻ, bỏ qua ${d.skipped} (trùng/thiếu).`);
        await load();
      }
    } catch {
      setMsg('Lỗi đọc file.');
    }
    e.target.value = '';
  }

  function exportAs(fmt: 'csv' | 'json' | 'tsv') {
    if (deck.length === 0) return;
    if (fmt === 'csv') download('ai-translator-vocab.csv', toCSV(deck), 'text/csv');
    else if (fmt === 'json') download('ai-translator-vocab.json', toJSON(deck), 'application/json');
    else download('ai-translator-vocab-anki.tsv', toTSV(deck), 'text/tab-separated-values');
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = deck.filter((c) => {
      if (topicFilter && (c.topic || DEFAULT_TOPIC) !== topicFilter) return false;
      if (q && !c.term.toLowerCase().includes(q) && !c.meaning.toLowerCase().includes(q)) return false;
      return true;
    });
    return [...list].sort((a, b) => b.createdAt - a.createdAt);
  }, [deck, query, topicFilter]);

  const enVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const viVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('vi'));

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: { theme: next } }).catch(() => {});
  };

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
          <button className="fc-theme" onClick={toggleTheme} title="Đổi giao diện sáng/tối">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      {/* Voice / rate settings */}
      <div className="fc-settings-bar">
        <span className="fc-settings-label">🔊 Giọng</span>
        <select className="fc-select" value={ttsVoiceEn} onChange={(e) => { setTtsVoiceEn(e.target.value); saveTts({ ttsVoiceEn: e.target.value }); }}>
          <option value="">EN mặc định</option>
          {enVoices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
        </select>
        <select className="fc-select" value={ttsVoiceVi} onChange={(e) => { setTtsVoiceVi(e.target.value); saveTts({ ttsVoiceVi: e.target.value }); }}>
          <option value="">VI mặc định</option>
          {viVoices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
        </select>
        <label className="fc-rate">
          Tốc độ {ttsRate.toFixed(2)}
          <input type="range" min="0.5" max="1.5" step="0.05" value={ttsRate}
            onChange={(e) => { const r = parseFloat(e.target.value); setTtsRate(r); saveTts({ ttsRate: r }); }} />
        </label>
        <label className="fc-autoimg" title="Tự thêm ảnh minh hoạ khi lưu từ mới">
          <input type="checkbox" checked={autoImgOn} onChange={toggleAutoImg} /> 🖼️ Tự thêm ảnh
        </label>
      </div>

      <nav className="fc-tabs">
        <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
          🎯 Ôn tập {stats.due > 0 && <span className="fc-badge">{stats.due}</span>}
        </button>
        <button className={tab === 'quiz' ? 'active' : ''} onClick={() => { setQuiz([]); setTab('quiz'); }}>
          🧠 Trắc nghiệm
        </button>
        <button className={tab === 'manage' ? 'active' : ''} onClick={() => setTab('manage')}>
          📚 Danh sách ({stats.total})
        </button>
        <button className={tab === 'add' ? 'active' : ''} onClick={() => { setForm(emptyForm); setTab('add'); }}>
          ➕ Tạo thẻ
        </button>
      </nav>

      {msg && <div className="fc-msg" onClick={() => setMsg('')}>{msg} ✕</div>}

      {loading ? (
        <div className="fc-empty">Đang tải…</div>
      ) : tab === 'review' ? (
        <section className="fc-review">
          <div className="fc-review-controls">
            <div className="fc-modes">
              {REVIEW_MODES.map((m) => (
                <button key={m.key} className={reviewMode === m.key ? 'active' : ''} onClick={() => setReviewMode(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
            <select className="fc-select" value={topicFilter} onChange={(e) => setTopicFilter(e.target.value)}>
              <option value="">Mọi chủ đề</option>
              {topics.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {!current ? (
            <div className="fc-empty">
              <div className="fc-empty-emoji">🎉</div>
              <p>{session.length === 0 && idx === 0 ? 'Không có thẻ nào trong mục này.' : 'Xong! Đã ôn hết thẻ.'}</p>
              {deck.length === 0 && (
                <p className="fc-hint">Bôi đen 1 từ trên web → tra từ điển → <b>📇 Lưu từ</b>, hoặc <b>Import</b>/<b>Tạo thẻ</b>.</p>
              )}
            </div>
          ) : (
            <>
              <div className="fc-progress">{idx + 1} / {session.length}</div>
              <div className={`fc-card ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((f) => !f)}>
                <div className="fc-card-term">
                  {current.term}
                  <button className="fc-play" title="Nghe" onClick={(e) => { e.stopPropagation(); speak(current.term, current.lang); }}>🔊</button>
                </div>
                {current.ipa && <div className="fc-card-ipa">/{current.ipa.replace(/^\/|\/$/g, '')}/</div>}
                {flipped ? (
                  <div className="fc-card-back">
                    {current.image && <img className="fc-card-image" src={current.image} alt="" />}
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
                    <button key={r.key} className={`fc-rate ${r.cls}`} onClick={() => rate(r.key)}>{r.label}</button>
                  ))}
                </div>
              ) : (
                <button className="fc-flip" onClick={() => setFlipped(true)}>Hiện nghĩa</button>
              )}
              <button className="fc-skip" onClick={skipCard} title="Chuyển thẻ tiếp theo mà không chấm">Bỏ qua →</button>
            </>
          )}
        </section>
      ) : tab === 'quiz' ? (
        <section className="fc-quiz">
          {quiz.length === 0 ? (
            <div className="fc-empty">
              <div className="fc-empty-emoji">🧠</div>
              {deck.length < 4 ? (
                <p>Cần ít nhất <b>4 thẻ</b> (có nghĩa) để làm trắc nghiệm. Hãy lưu/tạo thêm từ.</p>
              ) : (
                <>
                  <p>Chọn nghĩa đúng của từ được hiện. Tối đa 10 câu mỗi lượt.</p>
                  <select className="fc-select" value={topicFilter} onChange={(e) => setTopicFilter(e.target.value)} style={{ marginBottom: 12 }}>
                    <option value="">Mọi chủ đề</option>
                    {topics.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button className="fc-flip" onClick={startQuiz}>Bắt đầu trắc nghiệm</button>
                </>
              )}
            </div>
          ) : qIdx >= quiz.length ? (
            <div className="fc-empty">
              <div className="fc-empty-emoji">{qScore / quiz.length >= 0.8 ? '🏆' : '🎉'}</div>
              <p>Kết quả: <b>{qScore}/{quiz.length}</b> ({Math.round((qScore / quiz.length) * 100)}%)</p>
              <button className="fc-flip" onClick={startQuiz}>Làm lại</button>
            </div>
          ) : (
            <>
              <div className="fc-progress">{qIdx + 1} / {quiz.length} · Điểm {qScore}</div>
              <div className="fc-quiz-term">
                {quiz[qIdx].card.term}
                <button className="fc-play" title="Nghe" onClick={() => speak(quiz[qIdx].card.term, quiz[qIdx].card.lang)}>🔊</button>
              </div>
              {quiz[qIdx].card.ipa && <div className="fc-card-ipa">/{quiz[qIdx].card.ipa.replace(/^\/|\/$/g, '')}/</div>}
              <div className="fc-quiz-opts">
                {quiz[qIdx].options.map((opt, i) => {
                  const answered = qPicked !== null;
                  const isCorrect = i === quiz[qIdx].correct;
                  const cls = answered ? (isCorrect ? 'correct' : i === qPicked ? 'wrong' : 'dim') : '';
                  return (
                    <button key={i} className={`fc-quiz-opt ${cls}`} disabled={answered} onClick={() => pickQuiz(i)}>
                      {opt}
                    </button>
                  );
                })}
              </div>
              {qPicked !== null && (
                <button className="fc-flip" onClick={nextQuiz}>
                  {qIdx + 1 < quiz.length ? 'Câu tiếp →' : 'Xem kết quả'}
                </button>
              )}
            </>
          )}
        </section>
      ) : tab === 'manage' ? (
        <section className="fc-manage">
          <div className="fc-toolbar">
            <input className="fc-search" placeholder="🔍 Tìm từ / nghĩa…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className="fc-select" value={topicFilter} onChange={(e) => setTopicFilter(e.target.value)}>
              <option value="">Mọi chủ đề</option>
              {topics.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="fc-toolbar">
            <button className="fc-export" onClick={() => importRef.current?.click()}>⬆️ Import</button>
            <input ref={importRef} type="file" accept=".csv,.tsv,.json,text/csv,application/json" style={{ display: 'none' }} onChange={onImportPick} />
            <button className="fc-export" onClick={() => exportAs('csv')} disabled={deck.length === 0}>⬇️ CSV</button>
            <button className="fc-export" onClick={() => exportAs('json')} disabled={deck.length === 0}>⬇️ JSON</button>
            <button className="fc-export" onClick={() => exportAs('tsv')} disabled={deck.length === 0}>⬇️ Anki</button>
          </div>

          {filtered.length === 0 ? (
            <div className="fc-empty">{deck.length === 0 ? 'Chưa có từ nào.' : 'Không tìm thấy.'}</div>
          ) : (
            <ul className="fc-list">
              {filtered.map((c) => (
                <li key={c.id} className="fc-item">
                  {c.image && <img className="fc-item-thumb" src={c.image} alt="" />}
                  <div className="fc-item-main">
                    <div className="fc-item-term">
                      {c.term}
                      {c.ipa && <span className="fc-item-ipa"> /{c.ipa.replace(/^\/|\/$/g, '')}/</span>}
                      <button className="fc-play" title="Nghe" onClick={() => speak(c.term, c.lang)}>🔊</button>
                    </div>
                    <div className="fc-item-meaning">{c.meaning}</div>
                    {c.example && <div className="fc-item-example">“{c.example}”</div>}
                    <select className="fc-topic-select" value={c.topic || DEFAULT_TOPIC} onChange={(e) => updateTopic(c, e.target.value)}>
                      {[...new Set([DEFAULT_TOPIC, ...topics, c.topic || DEFAULT_TOPIC])].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="fc-item-side">
                    <span className="fc-item-due">{formatDue(c.due, Date.now())}</span>
                    <div className="fc-item-actions">
                      <button className="fc-icon-btn" title="Sửa" onClick={() => editCard(c)}>✏️</button>
                      <button className="fc-icon-btn" title="Xoá" onClick={() => del(c.id)}>🗑️</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="fc-form">
          <h2 className="fc-form-title">{form.id ? 'Sửa thẻ' : 'Tạo thẻ mới'}</h2>
          <label className="fc-field"><span>Từ / cụm từ *</span>
            <input className="fc-input" value={form.term} onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))} />
          </label>
          <label className="fc-field"><span>Nghĩa *</span>
            <input className="fc-input" value={form.meaning} onChange={(e) => setForm((f) => ({ ...f, meaning: e.target.value }))} />
          </label>
          <div className="fc-field-row">
            <label className="fc-field"><span>IPA</span>
              <input className="fc-input" value={form.ipa} onChange={(e) => setForm((f) => ({ ...f, ipa: e.target.value }))} />
            </label>
            <label className="fc-field"><span>Chủ đề</span>
              <input className="fc-input" list="fc-topics" value={form.topic} placeholder={DEFAULT_TOPIC}
                onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))} />
              <datalist id="fc-topics">{topics.map((t) => <option key={t} value={t} />)}</datalist>
            </label>
          </div>
          <label className="fc-field"><span>Ví dụ</span>
            <textarea className="fc-textarea" value={form.example} onChange={(e) => setForm((f) => ({ ...f, example: e.target.value }))} />
          </label>
          <div className="fc-field">
            <span>Ảnh minh hoạ (giúp nhớ từ)</span>
            <div className="fc-image-row">
              {form.image && <img className="fc-img-preview" src={form.image} alt="" />}
              <button className="fc-icon-btn" onClick={autoImage} disabled={!form.term.trim() || findingImg}>
                {findingImg ? '🔎 Đang tìm…' : '🖼️ Tìm ảnh tự động'}
              </button>
              <input type="file" accept="image/*" onChange={onImagePick} title="Hoặc tải ảnh của bạn" />
              {form.image && <button className="fc-icon-btn" onClick={() => setForm((f) => ({ ...f, image: undefined }))}>Xoá ảnh</button>}
            </div>
            {imgChoices.length > 1 && (
              <div className="fc-img-choices">
                {imgChoices.map((u) => (
                  <img
                    key={u}
                    src={u}
                    alt=""
                    className={`fc-img-choice ${form.image === u ? 'sel' : ''}`}
                    onClick={() => setForm((f) => ({ ...f, image: u }))}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="fc-form-actions">
            <button className="fc-flip" onClick={saveForm}>{form.id ? 'Lưu' : 'Tạo thẻ'}</button>
            <button className="fc-export" onClick={() => { setForm(emptyForm); setTab('manage'); }}>Huỷ</button>
          </div>
        </section>
      )}
    </div>
  );
}
