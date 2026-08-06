// ============================================
// Topic Practice — speaking & listening from an AI-generated pack
// ============================================

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PracticePack, DialogueLine, Language, SpeakingAssessment, VocabCard, DrillPack, PracticeVocab } from '../types';
import { isSpeechRecognitionSupported, recognizeOnce, scoreSpeech, type SpeechScore, type ScoredToken, type RecognitionHandle } from './speech';
import { cachedImage, loadImage } from './images';

const TOPIC_SUGGESTIONS = ['Nhà hàng', 'Sân bay', 'Phỏng vấn xin việc', 'Khách sạn', 'Mua sắm', 'Cuộc họp', 'Du lịch', 'Đi khám bệnh'];
const LEVELS: { key: string; label: string }[] = [
  { key: 'beginner', label: 'Cơ bản' },
  { key: 'intermediate', label: 'Trung cấp' },
  { key: 'advanced', label: 'Nâng cao' },
];

const SR_SUPPORTED = isSpeechRecognitionSupported();

interface PracticeStats {
  attempts: number;
  sumScore: number;
  streak: number;
  lastDate: string;
}
const EMPTY_STATS: PracticeStats = { attempts: 0, sumScore: 0, streak: 0, lastDate: '' };

function openUrl(url: string) {
  chrome.tabs.create({ url });
}

function youglishUrl(term: string) {
  return `https://youglish.com/pronounce/${encodeURIComponent(term)}/english`;
}
function youtubeSearchUrl(topic: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(topic + ' english conversation')}`;
}

const DAILY_TOPICS = [
  'Gọi món ở nhà hàng', 'Đặt phòng khách sạn', 'Phỏng vấn xin việc', 'Hỏi đường', 'Mua sắm quần áo',
  'Ở sân bay', 'Đi khám bệnh', 'Cuộc họp công việc', 'Nói về sở thích', 'Kể về cuối tuần',
  'Đặt lịch hẹn', 'Than phiền dịch vụ', 'Giới thiệu bản thân', 'Nói về thời tiết', 'Gọi điện đặt bàn',
  'Thuê xe', 'Ở quán cà phê', 'Nói về gia đình', 'Hỏi giá và mặc cả', 'Ở ngân hàng',
  'Đặt vé xem phim', 'Kế hoạch du lịch', 'Small talk với đồng nghiệp', 'Đi siêu thị', 'Hỏi thông tin tàu xe',
  'Nói về công việc của bạn', 'Chúc mừng và lời mời', 'Nói về ước mơ', 'Gặp bạn cũ', 'Nói về một bộ phim',
];

function dailyTopic(): string {
  const day = Math.floor(Date.now() / 86_400_000);
  return DAILY_TOPICS[day % DAILY_TOPICS.length];
}

function bumpDaily(prev: { lastDone: string; streak: number }): { lastDone: string; streak: number } {
  const today = new Date().toISOString().slice(0, 10);
  if (prev.lastDone === today) return prev;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return { lastDone: today, streak: prev.lastDone === yesterday ? prev.streak + 1 : 1 };
}

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function lastNDates(n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

function pickDeckWords(deck: VocabCard[], source: string): { words: string[]; label: string } {
  const now = Date.now();
  let cards = deck;
  if (source === 'due') cards = deck.filter((c) => c.due <= now);
  else if (source !== 'all') cards = deck.filter((c) => (c.topic || 'Chung') === source);
  if (cards.length === 0) cards = deck;
  const words = cards.slice(0, 14).map((c) => c.term);
  const label = source === 'due' ? 'Ôn từ đến hạn' : source === 'all' ? 'Ôn từ vựng' : source;
  return { words, label };
}

// Common function words that aren't worth drilling even when missed.
const WEAK_STOPWORDS = new Set([
  'the', 'and', 'are', 'was', 'were', 'been', 'being', 'for', 'with', 'that', 'this',
  'you', 'your', 'his', 'her', 'she', 'him', 'they', 'them', 'their', 'our', 'its',
  'not', 'but', 'can', 'will', 'would', 'could', 'should', 'have', 'has', 'had',
  'from', 'then', 'than', 'too', 'very', 'about', 'into', 'out', 'off', 'get', 'got',
  'there', 'here', 'what', 'when', 'where', 'who', 'how', 'which',
]);

interface WeakWord { misses: number; attempts: number; last: string }
type WeakWordMap = Record<string, WeakWord>;

/** Weak words ranked by miss count then miss rate. Only those missed at least once. */
function rankWeakWords(map: WeakWordMap): Array<{ word: string; misses: number; attempts: number }> {
  return Object.entries(map)
    .map(([word, v]) => ({ word, misses: v.misses, attempts: v.attempts }))
    .filter((w) => w.misses > 0)
    .sort((a, b) => b.misses - a.misses || b.misses / b.attempts - a.misses / a.attempts);
}

async function persistPack(key: string, pack: PracticePack, lv: string) {
  try {
    const r = await chrome.storage.local.get({ practicePacks: {} });
    const packs = (r.practicePacks || {}) as Record<string, { pack: PracticePack; level: string; at: number }>;
    packs[key] = { pack, level: lv, at: Date.now() };
    const capped = Object.fromEntries(
      Object.entries(packs).sort((a, b) => b[1].at - a[1].at).slice(0, 24),
    );
    await chrome.storage.local.set({ practicePacks: capped });
  } catch { /* ignore */ }
}

export default function PracticeApp() {
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState('intermediate');
  const [loading, setLoading] = useState(false);
  const [pack, setPack] = useState<PracticePack | null>(null);
  const [error, setError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [stats, setStats] = useState<PracticeStats>(EMPTY_STATS);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [todayTopic, setTodayTopic] = useState('');
  const [dailyStats, setDailyStats] = useState<{ lastDone: string; streak: number }>({ lastDone: '', streak: 0 });
  const [dashOpen, setDashOpen] = useState(false);
  const [daysData, setDaysData] = useState<Record<string, { attempts: number; sumScore: number }>>({});
  const [packTab, setPackTab] = useState<'vocab' | 'phrases' | 'dialogue' | 'passage'>('vocab');
  const [packNonce, setPackNonce] = useState(0); // bumped per applyPack to force list remount on switch
  const [rolePlay, setRolePlay] = useState(false);
  const [dictOpen, setDictOpen] = useState(false);
  const [passageDict, setPassageDict] = useState(false);
  const [showPassageVi, setShowPassageVi] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [ieltsOpen, setIeltsOpen] = useState(false);
  const [drillOpen, setDrillOpen] = useState(false);
  const [autoImg, setAutoImg] = useState(true); // auto-load illustrations for vocab
  const [weakWords, setWeakWords] = useState<WeakWordMap>({}); // words most often missed in speaking/dictation

  // Cache of generated packs (instant, token-free topic switching)
  const packCacheRef = useRef<Map<string, PracticePack>>(new Map());
  const [recent, setRecent] = useState<{ key: string; topic: string; level: string }[]>([]);

  // Practice from saved vocabulary
  const [deck, setDeck] = useState<VocabCard[]>([]);
  const [deckPicker, setDeckPicker] = useState(false);
  const [deckSource, setDeckSource] = useState('due');

  // TTS
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const ttsRef = useRef({ en: '', vi: '', rate: 0.95 });

  useEffect(() => {
    const loadVoices = () => setVoices(window.speechSynthesis?.getVoices() || []);
    loadVoices();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices;
    (async () => {
      try {
        const s = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        if (s?.data) {
          ttsRef.current = { en: s.data.ttsVoiceEn || '', vi: s.data.ttsVoiceVi || '', rate: s.data.ttsRate || 0.95 };
          const th = s.data.theme === 'light' ? 'light' : 'dark';
          setTheme(th);
          document.documentElement.dataset.theme = th;
          setAutoImg(s.data.vocabAutoImage !== false);
        }
      } catch { /* ignore */ }
      setTodayTopic(dailyTopic());
      try {
        const r = await chrome.storage.local.get({ practiceStats: EMPTY_STATS });
        setStats(r.practiceStats as PracticeStats);
      } catch { /* ignore */ }
      try {
        const r = await chrome.storage.local.get({ dailyChallenge: { lastDone: '', streak: 0 } });
        setDailyStats(r.dailyChallenge as { lastDone: string; streak: number });
      } catch { /* ignore */ }
      try {
        const r = await chrome.storage.local.get({ practiceDays: {} });
        setDaysData((r.practiceDays || {}) as Record<string, { attempts: number; sumScore: number }>);
      } catch { /* ignore */ }
      try {
        const r = await chrome.storage.local.get({ weakWords: {} });
        setWeakWords((r.weakWords || {}) as WeakWordMap);
      } catch { /* ignore */ }
      try {
        const r = await chrome.storage.local.get({ practicePacks: {} });
        const saved = (r.practicePacks || {}) as Record<string, { pack: PracticePack; level: string; at: number }>;
        const entries = Object.entries(saved).sort((a, b) => b[1].at - a[1].at);
        const rec: { key: string; topic: string; level: string }[] = [];
        for (const [k, v] of entries) {
          packCacheRef.current.set(k, v.pack);
          rec.push({ key: k, topic: v.pack.topic, level: v.level });
        }
        setRecent(rec.slice(0, 12));
      } catch { /* ignore */ }
    })();
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  function applyPack(p: PracticePack) {
    setPack(p);
    setPackTab(p.vocab.length ? 'vocab' : p.phrases.length ? 'phrases' : p.dialogue.length ? 'dialogue' : 'passage');
    // Bump so every list item gets a fresh key → remounts on topic switch. Without this,
    // React reuses instances by index and per-line state (score, transcript, shown image,
    // "recognizing") bleeds from the previous topic into the new one.
    setPackNonce((n) => n + 1);
  }

  function speak(text: string, lang: Language = 'en', onEnd?: () => void, rate?: number) {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const uri = lang === 'vi' ? ttsRef.current.vi : ttsRef.current.en;
    const v = voices.find((x) => x.voiceURI === uri);
    if (v) u.voice = v;
    else u.lang = lang === 'vi' ? 'vi-VN' : 'en-US';
    u.rate = rate ?? ttsRef.current.rate ?? 0.95;
    if (onEnd) u.onend = onEnd;
    window.speechSynthesis.speak(u);
  }

  function recordWeakWords(tokens: ScoredToken[]) {
    const meaningful = tokens.filter((t) => t.w.length >= 3 && !WEAK_STOPWORDS.has(t.w));
    if (!meaningful.length) return;
    setWeakWords((prev) => {
      const next: WeakWordMap = { ...prev };
      const today = todayStr();
      for (const t of meaningful) {
        const cur = next[t.w] || { misses: 0, attempts: 0, last: '' };
        next[t.w] = { misses: cur.misses + (t.ok ? 0 : 1), attempts: cur.attempts + 1, last: today };
      }
      chrome.storage.local.set({ weakWords: next }).catch(() => {});
      return next;
    });
  }

  async function recordScore(sc: SpeechScore) {
    const score = sc.score;
    recordWeakWords(sc.tokens);
    setStats((prev) => {
      const today = new Date().toISOString().slice(0, 10);
      const next: PracticeStats = { ...prev, attempts: prev.attempts + 1, sumScore: prev.sumScore + score };
      if (prev.lastDate !== today) {
        const y = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        next.streak = prev.lastDate === y ? prev.streak + 1 : 1;
        next.lastDate = today;
      }
      chrome.storage.local.set({ practiceStats: next }).catch(() => {});
      return next;
    });

    // Per-day activity for the progress dashboard.
    setDaysData((prev) => {
      const d = todayStr();
      const cur = prev[d] || { attempts: 0, sumScore: 0 };
      const next = { ...prev, [d]: { attempts: cur.attempts + 1, sumScore: cur.sumScore + score } };
      chrome.storage.local.set({ practiceDays: next }).catch(() => {});
      return next;
    });

    // Complete today's daily challenge when practicing today's topic.
    // Compare against the generated pack's topic (stable), not the live input box.
    const activeTopic = (pack?.topic || topic).trim().toLowerCase();
    if (todayTopic && activeTopic === todayTopic.toLowerCase()) {
      setDailyStats((prev) => {
        if (isToday(prev.lastDone)) return prev;
        const next = bumpDaily(prev);
        chrome.storage.local.set({ dailyChallenge: next }).catch(() => {});
        return next;
      });
    }
  }

  function packKey(t: string, lv: string) {
    return `${t.trim().toLowerCase()}|${lv}`;
  }

  function resetModes() {
    setRolePlay(false);
    setDictOpen(false);
    setPassageDict(false);
    setChatOpen(false);
    setIeltsOpen(false);
    setDrillOpen(false);
    setSaveMsg('');
    setError('');
  }

  function playPassage(sents: { en: string }[]) {
    let i = 0;
    const playNext = () => {
      if (i < sents.length) speak(sents[i++].en, 'en', playNext);
    };
    playNext();
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: { theme: next } }).catch(() => {});
  }

  function toggleAutoImg() {
    const next = !autoImg;
    setAutoImg(next);
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: { vocabAutoImage: next } }).catch(() => {});
  }

  /** Generate a fresh pack built around the words the user misses most, then close the dashboard. */
  function drillWeakWords() {
    const words = rankWeakWords(weakWords).slice(0, 12).map((w) => w.word);
    if (!words.length) return;
    setDashOpen(false);
    void generate('Từ hay sai của tôi', words);
  }

  async function generate(t?: string, words?: string[], lvl?: string) {
    const q = (t ?? topic).trim();
    if (!q || loading) return;
    const useLevel = lvl ?? level;
    setTopic(q);
    resetModes();

    // Instant + token-free if this exact topic+level (+word set) was generated before.
    const key = packKey(q, useLevel) + (words?.length ? `|w:${words.slice(0, 12).join(',')}` : '');
    const cached = packCacheRef.current.get(key);
    if (cached) {
      applyPack(cached);
      return;
    }

    setLoading(true);
    setPack(null);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GENERATE_PRACTICE', payload: { topic: q, level: useLevel, words } });
      if (res?.success && res.data) {
        const pack = res.data as PracticePack;
        applyPack(pack);
        packCacheRef.current.set(key, pack);
        void persistPack(key, pack, useLevel);
        if (!words?.length) {
          setRecent((prev) => [{ key, topic: q, level: useLevel }, ...prev.filter((r) => r.key !== key)].slice(0, 12));
        }
      } else {
        setError(res?.error || 'Không tạo được bài luyện.');
      }
    } catch {
      setError('Không kết nối được. Kiểm tra API key / reload extension.');
    }
    setLoading(false);
  }

  async function openDeckPicker() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_VOCAB' });
      const cards = (res?.data as VocabCard[]) || [];
      if (cards.length === 0) {
        setError('Sổ từ vựng chưa có từ nào — hãy lưu vài từ trước.');
        return;
      }
      setDeck(cards);
      setError('');
      setDeckPicker(true);
    } catch {
      setError('Không đọc được sổ từ vựng.');
    }
  }

  async function generateFromDeck() {
    const { words, label } = pickDeckWords(deck, deckSource);
    setDeckPicker(false);
    await generate(label, words);
  }

  function switchTo(r: { key: string; topic: string; level: string }) {
    const cached = packCacheRef.current.get(r.key);
    setLevel(r.level);
    setTopic(r.topic);
    resetModes();
    if (cached) applyPack(cached);
    else void generate(r.topic, undefined, r.level);
  }

  async function saveVocab() {
    if (!pack) return;
    const cards = pack.vocab.map((v) => ({
      term: v.term,
      meaning: v.meaning,
      ipa: v.ipa,
      example: v.example,
      topic: pack.topic,
      lang: 'en' as Language,
      image: cachedImage(v.term) || undefined, // carry the already-loaded illustration into the deck
    }));
    try {
      const res = await chrome.runtime.sendMessage({ type: 'IMPORT_VOCAB', payload: { cards } });
      const d = res?.data || { added: 0, skipped: 0 };
      setSaveMsg(`Đã lưu ${d.added} từ vào sổ (bỏ qua ${d.skipped} trùng).`);
    } catch {
      setSaveMsg('Lưu thất bại.');
    }
  }

  const canGenerate = topic.trim().length > 0 && !loading;
  const avg = stats.attempts > 0 ? Math.round(stats.sumScore / stats.attempts) : 0;

  return (
    <div className="pr-app">
      <header className="pr-header">
        <span className="pr-logo">🎯</span>
        <h1>Luyện tập theo chủ đề</h1>
        <div className="pr-header-right">
          {stats.attempts > 0 && (
            <div className="pr-stats">
              <span>🔥 {stats.streak} ngày</span>
              <span>🗣️ {stats.attempts} lượt</span>
              <span>📊 TB {avg}%</span>
            </div>
          )}
          <button className="pr-theme" onClick={() => { resetModes(); setDashOpen(true); }} title="Tiến độ luyện tập">📈</button>
          <button className="pr-theme" onClick={toggleTheme} title="Đổi giao diện sáng/tối">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      {/* Topic bar */}
      <div className="pr-topicbar">
        <div className="pr-topic-row">
          <input
            className="pr-input"
            placeholder="Nhập chủ đề (vd: đặt phòng khách sạn)…"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && generate()}
          />
          <select className="pr-select" value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
          <button className="pr-generate" onClick={() => generate()} disabled={!canGenerate}>
            {loading ? 'Đang tạo…' : '✨ Tạo bài luyện'}
          </button>
          <button
            className="pr-generate pr-chat-open"
            onClick={() => topic.trim() && setChatOpen(true)}
            disabled={!topic.trim() || !SR_SUPPORTED}
            title={SR_SUPPORTED ? 'Trò chuyện tự do với AI theo chủ đề' : 'Trình duyệt không hỗ trợ mic'}
          >
            🤖 Trò chuyện
          </button>
          <button
            className="pr-generate pr-ielts-open"
            onClick={() => topic.trim() && setIeltsOpen(true)}
            disabled={!topic.trim() || !SR_SUPPORTED}
            title={SR_SUPPORTED ? 'Nói tự do và được chấm theo 4 tiêu chí IELTS' : 'Trình duyệt không hỗ trợ mic'}
          >
            🎓 IELTS Speaking
          </button>
          <button
            className="pr-generate pr-deck-open"
            onClick={openDeckPicker}
            disabled={loading}
            title="Tạo bài luyện từ chính các từ đã lưu trong sổ"
          >
            📇 Từ sổ
          </button>
          <button
            className="pr-generate pr-drill-open"
            onClick={() => { resetModes(); setDrillOpen(true); }}
            disabled={!SR_SUPPORTED}
            title="Luyện phát âm các âm người Việt hay sai"
          >
            🔤 Drill âm
          </button>
        </div>

        {deckPicker && (
          <div className="pr-deck-picker">
            <span>Luyện nói từ sổ:</span>
            <select className="pr-select" value={deckSource} onChange={(e) => setDeckSource(e.target.value)}>
              <option value="due">Từ đến hạn</option>
              <option value="all">Tất cả</option>
              {Array.from(new Set(deck.map((c) => c.topic || 'Chung'))).map((t) => (
                <option key={t} value={t}>Chủ đề: {t}</option>
              ))}
            </select>
            <button className="pr-generate" onClick={generateFromDeck} disabled={loading}>
              {loading ? 'Đang tạo…' : '✨ Tạo'}
            </button>
            <button className="pr-act" onClick={() => setDeckPicker(false)}>Huỷ</button>
          </div>
        )}
        <div className="pr-chips">
          {TOPIC_SUGGESTIONS.map((s) => (
            <button key={s} className="pr-chip" onClick={() => generate(s)} disabled={loading}>{s}</button>
          ))}
        </div>
        {recent.length > 0 && (
          <div className="pr-chips pr-recent">
            <span className="pr-recent-label">↺ Gần đây:</span>
            {recent.map((r) => (
              <button key={r.key} className="pr-chip" onClick={() => switchTo(r)} title="Mở lại (đã lưu, không tốn token)">
                {r.topic}
              </button>
            ))}
          </div>
        )}
      </div>

      {todayTopic && (
        <div className="pr-daily">
          <div className="pr-daily-left">
            <span className="pr-daily-label">📅 Thử thách hôm nay</span>
            <span className="pr-daily-topic">{todayTopic}</span>
          </div>
          <div className="pr-daily-right">
            {dailyStats.streak > 0 && <span className="pr-daily-streak">🔥 {dailyStats.streak} ngày liên tiếp</span>}
            {isToday(dailyStats.lastDone) ? (
              <span className="pr-daily-done">✅ Đã hoàn thành</span>
            ) : (
              <button className="pr-generate" onClick={() => generate(todayTopic)} disabled={loading}>Bắt đầu</button>
            )}
          </div>
        </div>
      )}

      {!SR_SUPPORTED && (
        <div className="pr-note">Trình duyệt không hỗ trợ nhận diện giọng nói — phần 🎤 Nói sẽ bị tắt. (Dùng Chrome, cho phép mic.)</div>
      )}
      {error && <div className="pr-error">⚠️ {error}</div>}

      {loading && (
        <div className="pr-loading">
          <div className="pr-spinner" /> Đang soạn từ vựng, mẫu câu &amp; hội thoại cho “{topic}”…
        </div>
      )}

      {chatOpen && (
        <ChatMode topic={topic} level={level} speak={speak} onExit={() => setChatOpen(false)} />
      )}

      {ieltsOpen && (
        <IeltsMode topic={topic} speak={speak} onExit={() => setIeltsOpen(false)} />
      )}

      {drillOpen && (
        <DrillMode speak={speak} onScore={recordScore} onExit={() => setDrillOpen(false)} />
      )}

      {dashOpen && (
        <Dashboard stats={stats} daysData={daysData} dailyStats={dailyStats} weak={rankWeakWords(weakWords)} onDrill={drillWeakWords} onExit={() => setDashOpen(false)} />
      )}

      {!chatOpen && !ieltsOpen && !drillOpen && !dashOpen && pack && (
        <div className="pr-content">
          <div className="pr-packtabs">
            {([
              { k: 'vocab', label: `Từ vựng (${pack.vocab.length})`, n: pack.vocab.length },
              { k: 'phrases', label: `Mẫu câu (${pack.phrases.length})`, n: pack.phrases.length },
              { k: 'dialogue', label: `Hội thoại (${pack.dialogue.length})`, n: pack.dialogue.length },
              { k: 'passage', label: 'Bài nghe', n: pack.passage?.length || 0 },
            ] as const)
              .filter((t) => t.n > 0)
              .map((t) => (
                <button key={t.k} className={packTab === t.k ? 'active' : ''} onClick={() => setPackTab(t.k)}>
                  {t.label}
                </button>
              ))}
          </div>

          {/* Vocab */}
          {packTab === 'vocab' && pack.vocab.length > 0 && (
            <section className="pr-section">
              <div className="pr-section-head">
                <h2>Từ vựng</h2>
                <div className="pr-head-actions">
                  <button
                    className={`pr-act ${autoImg ? 'on' : ''}`}
                    onClick={toggleAutoImg}
                    title="Tự động tải ảnh minh hoạ cho từ (tải từ từ, có cache)"
                  >
                    {autoImg ? '🖼️ Ảnh tự động: Bật' : '🖼️ Ảnh tự động: Tắt'}
                  </button>
                  <button className="pr-act" onClick={() => openUrl(youtubeSearchUrl(pack.topic))} title="Xem video hội thoại chủ đề này trên YouTube">📺 Video chủ đề</button>
                  <button className="pr-save" onClick={saveVocab}>📇 Lưu tất cả vào sổ</button>
                </div>
              </div>
              {saveMsg && <div className="pr-savemsg">{saveMsg}</div>}
              <div className="pr-vocab-grid">
                {pack.vocab.map((v, i) => (
                  <VocabItem key={`${packNonce}-${i}`} v={v} speak={speak} autoImg={autoImg} />
                ))}
              </div>
            </section>
          )}

          {/* Phrases */}
          {packTab === 'phrases' && pack.phrases.length > 0 && (
            <section className="pr-section">
              <div className="pr-section-head"><h2>Mẫu câu — luyện nói &amp; nghe</h2></div>
              {pack.phrases.map((p, i) => (
                <PracticeLine key={`${packNonce}-${i}`} en={p.en} vi={p.vi} onSpeak={speak} onScore={recordScore} />
              ))}
            </section>
          )}

          {/* Dialogue */}
          {packTab === 'dialogue' && pack.dialogue.length > 0 && (
            <section className="pr-section">
              <div className="pr-section-head">
                <h2>Hội thoại</h2>
                {!rolePlay && !dictOpen && (
                  <div className="pr-head-actions">
                    {SR_SUPPORTED && <button className="pr-save" onClick={() => setRolePlay(true)}>🎭 Đóng vai</button>}
                    <button className="pr-save" onClick={() => setDictOpen(true)}>🎧 Chép chính tả</button>
                  </div>
                )}
              </div>
              {dictOpen ? (
                <DictationMode key={`dict-${packNonce}`} segments={pack.dialogue} speak={speak} onScore={recordScore} onExit={() => setDictOpen(false)} />
              ) : rolePlay ? (
                <RolePlay key={`rp-${packNonce}`} dialogue={pack.dialogue} speak={speak} onScore={recordScore} onExit={() => setRolePlay(false)} />
              ) : (
                pack.dialogue.map((d: DialogueLine, i) => (
                  <PracticeLine key={`${packNonce}-${i}`} en={d.en} vi={d.vi} speaker={d.speaker} onSpeak={speak} onScore={recordScore} />
                ))
              )}
            </section>
          )}

          {/* Listening passage (monologue) */}
          {packTab === 'passage' && pack.passage && pack.passage.length > 0 && (
            <section className="pr-section">
              <div className="pr-section-head">
                <h2>Bài nghe (đoạn văn)</h2>
                {!passageDict && (
                  <div className="pr-head-actions">
                    <button className="pr-act" onClick={() => playPassage(pack.passage)}>🔊 Nghe cả bài</button>
                    <button className="pr-act" onClick={() => setShowPassageVi((v) => !v)}>🇻🇳 Dịch</button>
                    <button className="pr-save" onClick={() => setPassageDict(true)}>🎧 Chép chính tả</button>
                  </div>
                )}
              </div>
              {passageDict ? (
                <DictationMode key={`pdict-${packNonce}`} segments={pack.passage} speak={speak} onScore={recordScore} onExit={() => setPassageDict(false)} />
              ) : (
                <div className="pr-passage">
                  {pack.passage.map((s, i) => (
                    <span key={i}>
                      <span className="pr-passage-sent" onClick={() => speak(s.en, 'en')} title="Bấm để nghe">{s.en}</span>
                      {showPassageVi && <span className="pr-passage-vi"> ({s.vi})</span>}{' '}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {!chatOpen && !ieltsOpen && !drillOpen && !dashOpen && !pack && !loading && !error && (
        <div className="pr-empty">
          <div className="pr-empty-emoji">🗣️</div>
          <p>Chọn hoặc nhập một chủ đề để bắt đầu luyện <b>nói</b> &amp; <b>nghe</b>, hoặc bấm <b>🤖 Trò chuyện</b>.</p>
        </div>
      )}
    </div>
  );
}

// ---- AI conversation partner (free-talk) ----

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  correction?: string;
}

function ChatMode({
  topic,
  level,
  speak,
  onExit,
}: {
  topic: string;
  level: string;
  speak: (text: string, lang?: Language) => void;
  onExit: () => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [thinking, setThinking] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [interim, setInterim] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const recRef = useRef<RecognitionHandle | null>(null);

  useEffect(() => {
    mounted.current = true;
    void turn([]); // AI opens the conversation
    return () => {
      mounted.current = false;
      window.speechSynthesis?.cancel();
      recRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages, thinking]);

  async function turn(history: ChatMsg[]) {
    setThinking(true);
    try {
      const payloadMsgs = history.map((m) => ({ role: m.role, text: m.text }));
      const res = await chrome.runtime.sendMessage({ type: 'CHAT_TURN', payload: { messages: payloadMsgs, topic, level } });
      if (!mounted.current) return;
      if (res?.success && res.data?.reply) {
        const reply: string = res.data.reply;
        const correction: string = res.data.correction || '';
        setMessages((m) => [...m, { role: 'assistant', text: reply, correction }]);
        speak(reply, 'en');
      } else {
        setMessages((m) => [...m, { role: 'assistant', text: `⚠️ ${res?.error || 'Không phản hồi được.'}` }]);
      }
    } catch {
      if (mounted.current) setMessages((m) => [...m, { role: 'assistant', text: '⚠️ Lỗi kết nối.' }]);
    }
    if (mounted.current) setThinking(false);
  }

  async function speakTurn() {
    if (recognizing || thinking) return;
    setRecognizing(true);
    setInterim('');
    const { promise, handle } = recognizeOnce('en-US', setInterim);
    recRef.current = handle;
    let said = '';
    try {
      said = await promise;
    } catch {
      /* no speech captured */
    }
    if (!mounted.current) return;
    setRecognizing(false);
    setInterim('');
    if (!said.trim()) return;
    const nextMsgs: ChatMsg[] = [...messages, { role: 'user', text: said }];
    setMessages(nextMsgs);
    await turn(nextMsgs);
  }

  return (
    <div className="pr-chat">
      <div className="pr-chat-head">
        <span>🤖 Trò chuyện · {topic}</span>
        <button className="pr-act" onClick={onExit}>Thoát</button>
      </div>
      <div className="pr-chat-list" ref={listRef}>
        {messages.map((m, i) => (
          <div key={i} className={`pr-msg ${m.role}`}>
            <div className="pr-bubble">
              <span>{m.text}</span>
              {m.role === 'assistant' && <button className="pr-mini" title="Nghe lại" onClick={() => speak(m.text, 'en')}>🔊</button>}
            </div>
            {m.correction && <div className="pr-correction">📝 {m.correction}</div>}
          </div>
        ))}
        {(recognizing || interim) && (
          <div className="pr-msg user"><div className="pr-bubble interim">{interim || '…'}</div></div>
        )}
        {thinking && (
          <div className="pr-msg assistant"><div className="pr-bubble"><span className="pr-typing">Đang nghĩ…</span></div></div>
        )}
      </div>
      <div className="pr-chat-actions">
        <button
          className={`pr-generate ${recognizing ? 'rec' : ''}`}
          onClick={recognizing ? () => recRef.current?.stop() : speakTurn}
          disabled={thinking}
        >
          {recognizing ? '● Đang nghe… (bấm để dừng)' : '🎤 Nói'}
        </button>
      </div>
    </div>
  );
}

// ---- IELTS Speaking: free answer → 4-criteria assessment ----

const IELTS_CRITERIA: { key: keyof SpeakingAssessment['criteria']; label: string }[] = [
  { key: 'fluency', label: 'Fluency & Coherence' },
  { key: 'lexical', label: 'Lexical Resource' },
  { key: 'grammar', label: 'Grammatical Range & Accuracy' },
  { key: 'pronunciation', label: 'Pronunciation' },
];

function bandClass(b: number): string {
  return b >= 7 ? 'good' : b >= 5.5 ? 'mid' : 'low';
}

function IeltsMode({
  topic,
  speak,
  onExit,
}: {
  topic: string;
  speak: (text: string, lang?: Language) => void;
  onExit: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [assessing, setAssessing] = useState(false);
  const [assessment, setAssessment] = useState<SpeakingAssessment | null>(null);
  const [error, setError] = useState('');
  const recRef = useRef<RecognitionHandle | null>(null);

  // Stop a still-running (continuous) recognition if the user exits mid-recording.
  useEffect(() => () => recRef.current?.stop(), []);

  const cueQuestion = `Talk about ${topic}`;
  const cueBullets = ['what it is / what happens', 'when or where it happens', 'why it matters to you', 'how you feel about it'];

  function startRec() {
    setAssessment(null);
    setError('');
    setTranscript('');
    setRecording(true);
    const { promise, handle } = recognizeOnce('en-US', setTranscript, { continuous: true });
    recRef.current = handle;
    promise
      .then((final) => { if (final) setTranscript(final); })
      .catch(() => {})
      .finally(() => setRecording(false));
  }

  function stopRec() {
    recRef.current?.stop();
  }

  async function assess() {
    if (!transcript.trim()) return;
    setAssessing(true);
    setError('');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'ASSESS_SPEAKING', payload: { transcript, question: cueQuestion } });
      if (res?.success && res.data) setAssessment(res.data as SpeakingAssessment);
      else setError(res?.error || 'Không chấm được.');
    } catch {
      setError('Lỗi kết nối.');
    }
    setAssessing(false);
  }

  return (
    <div className="pr-ielts">
      <div className="pr-chat-head">
        <span>🎓 IELTS Speaking · {topic}</span>
        <button className="pr-act" onClick={onExit}>Thoát</button>
      </div>

      <div className="pr-cue">
        <div className="pr-cue-title">Talk about <b>{topic}</b>.</div>
        <div className="pr-cue-sub">You should say:</div>
        <ul>{cueBullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
        <div className="pr-cue-hint">Nói tự do 1–2 phút, rồi bấm chấm điểm.</div>
      </div>

      <div className="pr-ielts-record">
        {!recording ? (
          <button className="pr-generate" onClick={startRec}>🎤 {transcript ? 'Nói lại' : 'Bắt đầu nói'}</button>
        ) : (
          <button className="pr-generate rec" onClick={stopRec}>■ Dừng ghi</button>
        )}
        {transcript && !recording && (
          <button className="pr-generate pr-ielts-open" onClick={assess} disabled={assessing}>
            {assessing ? 'Đang chấm…' : '📝 Chấm điểm IELTS'}
          </button>
        )}
      </div>

      {transcript && <div className="pr-answer">“{transcript}”</div>}
      {error && <div className="pr-error">⚠️ {error}</div>}
      {assessing && <div className="pr-loading"><div className="pr-spinner" /> Giám khảo AI đang chấm theo 4 tiêu chí…</div>}
      {assessment && <AssessmentCard a={assessment} speak={speak} />}
    </div>
  );
}

function AssessmentCard({ a, speak }: { a: SpeakingAssessment; speak: (text: string, lang?: Language) => void }) {
  return (
    <div className="pr-assess">
      <div className="pr-assess-overall">
        <div className={`pr-band ${bandClass(a.overall)}`}>{a.overall.toFixed(1)}</div>
        <div className="pr-assess-overall-label">Band tổng<br /><span>(ước lượng)</span></div>
      </div>

      <div className="pr-assess-crit">
        {IELTS_CRITERIA.map((c) => {
          const cs = a.criteria[c.key];
          return (
            <div className="pr-crit" key={c.key}>
              <div className="pr-crit-head">
                <span>{c.label}</span>
                <span className={`pr-band sm ${bandClass(cs.band)}`}>{cs.band.toFixed(1)}</span>
              </div>
              <div className="pr-crit-comment">{cs.comment}</div>
            </div>
          );
        })}
      </div>

      {a.strengths.length > 0 && (
        <div className="pr-assess-list"><h4>✅ Điểm mạnh</h4><ul>{a.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
      )}
      {a.improvements.length > 0 && (
        <div className="pr-assess-list"><h4>🎯 Cần cải thiện</h4><ul>{a.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
      )}
      {a.better && (
        <div className="pr-assess-model">
          <h4>💬 Câu trả lời mẫu (Band 8+) <button className="pr-mini" title="Nghe" onClick={() => speak(a.better, 'en')}>🔊</button></h4>
          <p>{a.better}</p>
        </div>
      )}

      <div className="pr-note" style={{ marginTop: 10 }}>
        Lưu ý: điểm <b>Pronunciation</b> chỉ ước lượng từ bản ghi giọng nói tự động — không thay thế giám khảo thật.
      </div>
    </div>
  );
}

// ---- Dictation: listen to each segment, type it, get scored ----

function DictationMode({
  segments,
  speak,
  onScore,
  onExit,
}: {
  segments: { en: string; vi: string; speaker?: string }[];
  speak: (text: string, lang?: Language, onEnd?: () => void, rate?: number) => void;
  onScore: (sc: SpeechScore) => void;
  onExit: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState('');
  const [score, setScore] = useState<SpeechScore | null>(null);
  const [scores, setScores] = useState<number[]>([]);
  const seg = segments[idx];
  const done = idx >= segments.length;

  useEffect(() => {
    if (!done && seg) speak(seg.en, 'en');
    return () => window.speechSynthesis?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  function check() {
    if (!seg || score) return;
    const sc = scoreSpeech(seg.en, input);
    setScore(sc);
    setScores((s) => [...s, sc.score]);
    onScore(sc);
  }
  function next() { setInput(''); setScore(null); setIdx((i) => i + 1); }
  function retry() { setInput(''); setScore(null); }
  function restart() { setIdx(0); setInput(''); setScore(null); setScores([]); }

  if (done) {
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    return (
      <div className="pr-roleplay pr-roleplay-done">
        <div className="pr-empty-emoji">🎧</div>
        <p>Xong! Điểm chép chính tả trung bình: <b>{avg}%</b> ({scores.length} đoạn)</p>
        <div className="pr-line-actions" style={{ justifyContent: 'center' }}>
          <button className="pr-act" onClick={restart}>Làm lại</button>
          <button className="pr-act" onClick={onExit}>Thoát</button>
        </div>
      </div>
    );
  }

  const progress = Math.round((idx / segments.length) * 100);

  return (
    <div className="pr-roleplay">
      <div className="pr-progress"><div className="pr-progress-fill" style={{ width: `${progress}%` }} /></div>
      <div className="pr-roleplay-bar">
        <span>🎧 Nghe &amp; chép · Đoạn {idx + 1}/{segments.length}</span>
        <button className="pr-act" onClick={onExit}>Thoát</button>
      </div>

      <div className="pr-turn">
        {seg.speaker && <span className="pr-speaker">{seg.speaker}</span>}
        <div className="pr-line-body">
          <div className="pr-line-actions">
            <button className="pr-act" onClick={() => speak(seg.en, 'en')}>🔊 Nghe</button>
            <button className="pr-act" onClick={() => speak(seg.en, 'en', undefined, 0.6)}>🐢 Chậm</button>
          </div>

          {!score ? (
            <>
              <input
                className="pr-dict-input"
                style={{ width: '100%', marginTop: 10 }}
                placeholder="Nghe rồi gõ lại câu bạn nghe được…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && check()}
                autoFocus
              />
              <div className="pr-line-actions">
                <button className="pr-act" onClick={check} disabled={!input.trim()}>Kiểm tra</button>
                <button className="pr-act" onClick={next}>Bỏ qua →</button>
              </div>
            </>
          ) : (
            <>
              <div className="pr-line-en" style={{ marginTop: 8 }}>
                {score.tokens.map((t, k) => <span key={k} className={t.ok ? 'ok' : 'miss'}>{t.w} </span>)}
              </div>
              <div className="pr-line-vi">{seg.vi}</div>
              <div className="pr-transcript">Bạn gõ: “{input}”</div>
              <div className="pr-line-actions">
                <span className={`pr-score ${score.score >= 70 ? 'good' : 'low'}`}>{score.score}%</span>
                <button className="pr-act" onClick={retry}>🔁 Thử lại</button>
                <button className="pr-act" onClick={next}>Tiếp →</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- One practice line: listen (TTS), speak (recognition), dictation ----

function PracticeLine({
  en,
  vi,
  speaker,
  onSpeak,
  onScore,
}: {
  en: string;
  vi: string;
  speaker?: string;
  onSpeak: (text: string, lang?: Language) => void;
  onScore: (sc: SpeechScore) => void;
}) {
  const [recognizing, setRecognizing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [score, setScore] = useState<SpeechScore | null>(null);
  const [dictOpen, setDictOpen] = useState(false);
  const [dictInput, setDictInput] = useState('');
  const [dictScore, setDictScore] = useState<SpeechScore | null>(null);
  const stopRef = useRef<() => void>(() => {});

  // Stop a live mic if this line unmounts (e.g. switching pack tabs mid-listen).
  useEffect(() => () => stopRef.current(), []);

  async function startSpeak() {
    if (recognizing) {
      stopRef.current();
      return;
    }
    setScore(null);
    setTranscript('');
    setRecognizing(true);
    const { promise, handle } = recognizeOnce('en-US', setTranscript);
    stopRef.current = handle.stop;
    try {
      const said = await promise;
      const sc = scoreSpeech(en, said);
      setScore(sc);
      onScore(sc);
    } catch {
      setTranscript('(không nghe được — kiểm tra quyền micro)');
    }
    setRecognizing(false);
  }

  function checkDictation() {
    const sc = scoreSpeech(en, dictInput);
    setDictScore(sc);
    onScore(sc);
  }

  const shown = score || dictScore;

  return (
    <div className="pr-line">
      {speaker && <span className="pr-speaker">{speaker}</span>}
      <div className="pr-line-body">
        <div className="pr-line-en">
          {shown
            ? shown.tokens.map((t, i) => (
                <span key={i} className={t.ok ? 'ok' : 'miss'}>{t.w} </span>
              ))
            : dictOpen && !dictScore
            ? <span className="pr-masked">🔊 Nghe rồi gõ lại — câu đang ẩn</span>
            : en}
        </div>
        <div className="pr-line-vi">{vi}</div>

        <div className="pr-line-actions">
          <button className="pr-act" onClick={() => onSpeak(en, 'en')}>🔊 Nghe</button>
          <button
            className={`pr-act ${recognizing ? 'rec' : ''}`}
            onClick={startSpeak}
            disabled={!SR_SUPPORTED}
            title={SR_SUPPORTED ? 'Đọc to câu này' : 'Trình duyệt không hỗ trợ'}
          >
            {recognizing ? '● Đang nghe…' : '🎤 Nói'}
          </button>
          <button className="pr-act" onClick={() => setDictOpen((o) => !o)}>🎧 Chép chính tả</button>
          {score && <span className={`pr-score ${score.score >= 70 ? 'good' : 'low'}`}>{score.score}%</span>}
        </div>

        {transcript && <div className="pr-transcript">Bạn nói: “{transcript}”</div>}

        {dictOpen && (
          <div className="pr-dict">
            <button className="pr-act" onClick={() => onSpeak(en, 'en')}>🔊 Nghe lại</button>
            <input
              className="pr-dict-input"
              placeholder="Gõ lại những gì bạn nghe…"
              value={dictInput}
              onChange={(e) => setDictInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && checkDictation()}
            />
            <button className="pr-act" onClick={checkDictation}>Kiểm tra</button>
            {dictScore && <span className={`pr-score ${dictScore.score >= 70 ? 'good' : 'low'}`}>{dictScore.score}%</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Role-play: the user speaks one side of the dialogue (VI cue → speak EN) ----

function RolePlay({
  dialogue,
  speak,
  onScore,
  onExit,
}: {
  dialogue: DialogueLine[];
  speak: (text: string, lang?: Language, onEnd?: () => void) => void;
  onScore: (sc: SpeechScore) => void;
  onExit: () => void;
}) {
  const speakers = useMemo(() => Array.from(new Set(dialogue.map((d) => d.speaker))), [dialogue]);
  const [role, setRole] = useState(speakers[1] || speakers[0] || 'B');
  const [auto, setAuto] = useState(false);
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [score, setScore] = useState<SpeechScore | null>(null);
  const [scores, setScores] = useState<number[]>([]);

  const mounted = useRef(true);
  const recRef = useRef<RecognitionHandle | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.speechSynthesis?.cancel();
      recRef.current?.stop();
    };
  }, []);

  const line = dialogue[i];
  const done = i >= dialogue.length;
  const isUser = !!line && line.speaker === role;

  function next() {
    if (!mounted.current) return;
    setRevealed(false);
    setShowAnswer(false);
    setTranscript('');
    setScore(null);
    setI((x) => x + 1);
  }

  function retry() {
    setRevealed(false);
    setShowAnswer(false);
    setTranscript('');
    setScore(null);
  }

  async function userSpeak() {
    if (recognizing || !line) return;
    setRecognizing(true);
    setTranscript('');
    const { promise, handle } = recognizeOnce('en-US', setTranscript);
    recRef.current = handle;
    try {
      const said = await promise;
      if (!mounted.current) return;
      const sc = scoreSpeech(line.en, said);
      setScore(sc);
      setScores((s) => [...s, sc.score]);
      onScore(sc);
    } catch {
      if (mounted.current) setTranscript('(không nghe được — kiểm tra quyền micro)');
    }
    if (!mounted.current) return;
    setRevealed(true);
    setRecognizing(false);
  }

  function restart() {
    setI(0);
    setRevealed(false);
    setShowAnswer(false);
    setTranscript('');
    setScore(null);
    setScores([]);
  }

  // Auto mode: app voices its lines and advances; the learner's turn auto-starts the mic.
  useEffect(() => {
    if (done || !line || !auto) return;
    if (isUser) {
      if (revealed || recognizing) return;
      const t = setTimeout(() => { void userSpeak(); }, 600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => speak(line.en, 'en', () => { if (mounted.current) next(); }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, auto]);

  // Auto mode: after the learner's line is scored, move on shortly.
  useEffect(() => {
    if (!auto || !isUser || !revealed || !score) return;
    const t = setTimeout(() => { if (mounted.current) next(); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, score, auto]);

  if (done) {
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    return (
      <div className="pr-roleplay pr-roleplay-done">
        <div className="pr-empty-emoji">🎉</div>
        <p>Hoàn thành! Điểm nói trung bình: <b>{avg}%</b> ({scores.length} lượt)</p>
        <div className="pr-line-actions" style={{ justifyContent: 'center' }}>
          <button className="pr-act" onClick={restart}>Làm lại</button>
          <button className="pr-act" onClick={onExit}>Thoát</button>
        </div>
      </div>
    );
  }

  const progress = Math.round((i / dialogue.length) * 100);

  return (
    <div className="pr-roleplay">
      <div className="pr-progress"><div className="pr-progress-fill" style={{ width: `${progress}%` }} /></div>

      <div className="pr-roleplay-bar">
        <span>Đóng vai <b>{role}</b> · Lượt {i + 1}/{dialogue.length}</span>
        <div className="pr-roleplay-controls">
          <button
            className={`pr-act ${auto ? 'rec' : ''}`}
            onClick={() => setAuto((a) => !a)}
            title="Tự động: máy đọc lời + tự bật mic tới lượt bạn"
          >
            {auto ? '⏸ Tự động' : '▶️ Tự động'}
          </button>
          <select className="pr-select" value={role} onChange={(e) => { setRole(e.target.value); restart(); }}>
            {speakers.map((s) => <option key={s} value={s}>Vai {s}</option>)}
          </select>
          <button className="pr-act" onClick={onExit}>Thoát</button>
        </div>
      </div>

      <div className="pr-turn">
        <span className="pr-speaker">{line.speaker}</span>
        <div className="pr-line-body">
          {isUser ? (
            <>
              <div className="pr-turn-cue">🗣️ Lượt của bạn — nói câu này bằng tiếng Anh:</div>
              <div className="pr-line-vi" style={{ fontSize: 15 }}>{line.vi}</div>
              {(revealed || showAnswer) && (
                <div className="pr-line-en" style={{ marginTop: 6 }}>
                  {score
                    ? score.tokens.map((t, k) => <span key={k} className={t.ok ? 'ok' : 'miss'}>{t.w} </span>)
                    : line.en}
                </div>
              )}
              {transcript && <div className="pr-transcript">Bạn nói: “{transcript}”</div>}
              <div className="pr-line-actions">
                {!revealed ? (
                  <>
                    <button className={`pr-act ${recognizing ? 'rec' : ''}`} onClick={userSpeak}>
                      {recognizing ? '● Đang nghe…' : '🎤 Nói'}
                    </button>
                    {!showAnswer && <button className="pr-act" onClick={() => setShowAnswer(true)}>💡 Xem đáp án</button>}
                    {showAnswer && <button className="pr-act" onClick={() => speak(line.en, 'en')}>🔊 Nghe mẫu</button>}
                    <button className="pr-act" onClick={next}>Bỏ qua →</button>
                  </>
                ) : (
                  <>
                    <button className="pr-act" onClick={() => speak(line.en, 'en')}>🔊 Nghe mẫu</button>
                    {score && <span className={`pr-score ${score.score >= 70 ? 'good' : 'low'}`}>{score.score}%</span>}
                    <button className="pr-act" onClick={retry}>🔁 Thử lại</button>
                    <button className="pr-act" onClick={next}>Tiếp →</button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="pr-line-en">{line.en}</div>
              <div className="pr-line-vi">{line.vi}</div>
              <div className="pr-line-actions">
                <button className="pr-act" onClick={() => speak(line.en, 'en')}>🔊 Nghe</button>
                <button className="pr-act" onClick={next}>Tiếp →</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Pronunciation drills ----

const DRILL_SOUNDS: { key: string; label: string }[] = [
  { key: 'th sounds (θ / ð) as in think and this', label: 'th (θ/ð)' },
  { key: 'final consonants that Vietnamese speakers drop (cat, bird, help, hard)', label: 'Phụ âm cuối' },
  { key: '-ed past endings (worked /t/, played /d/, wanted /ɪd/)', label: 'Đuôi -ed' },
  { key: '-s / -es endings (cats /s/, dogs /z/, watches /ɪz/)', label: 'Đuôi -s/-es' },
  { key: 'r versus l (rice/lice, right/light)', label: 'r vs l' },
  { key: 'short vs long i, /ɪ/ vs /iː/ (ship/sheep, bit/beat)', label: 'ship / sheep' },
  { key: 'sh vs s vs ch (she, see, cheese)', label: 'sh / s / ch' },
  { key: 'v versus w (vine/wine, vest/west)', label: 'v vs w' },
];

function WordSpeak({ word, speak, onScore }: { word: string; speak: (t: string, l?: Language) => void; onScore: (sc: SpeechScore) => void }) {
  const [recognizing, setRecognizing] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const recRef = useRef<RecognitionHandle | null>(null);

  useEffect(() => () => recRef.current?.stop(), []);

  async function go() {
    if (recognizing) return;
    setRecognizing(true);
    setScore(null);
    const { promise, handle } = recognizeOnce('en-US', () => {});
    recRef.current = handle;
    try {
      const said = await promise;
      const sc = scoreSpeech(word, said);
      setScore(sc.score);
      onScore(sc);
    } catch {
      /* ignore */
    }
    setRecognizing(false);
  }

  return (
    <span className="pr-word">
      <b>{word}</b>
      <button className="pr-mini" title="Nghe" onClick={() => speak(word, 'en')}>🔊</button>
      <button className="pr-mini" title="Nói thử" onClick={go} disabled={!SR_SUPPORTED}>{recognizing ? '●' : '🎤'}</button>
      {score !== null && <span className={`pr-score ${score >= 70 ? 'good' : 'low'}`}>{score}%</span>}
    </span>
  );
}

function DrillMode({
  speak,
  onScore,
  onExit,
}: {
  speak: (text: string, lang?: Language) => void;
  onScore: (sc: SpeechScore) => void;
  onExit: () => void;
}) {
  const [sound, setSound] = useState('');
  const [loading, setLoading] = useState(false);
  const [drill, setDrill] = useState<DrillPack | null>(null);
  const [error, setError] = useState('');

  async function gen(s: string) {
    setSound(s);
    setLoading(true);
    setError('');
    setDrill(null);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GENERATE_DRILL', payload: { sound: s } });
      if (res?.success && res.data) setDrill(res.data as DrillPack);
      else setError(res?.error || 'Không tạo được bài drill.');
    } catch {
      setError('Lỗi kết nối. Kiểm tra API key.');
    }
    setLoading(false);
  }

  return (
    <div className="pr-ielts">
      <div className="pr-chat-head">
        <span>🔤 Drill phát âm âm khó</span>
        <button className="pr-act" onClick={onExit}>Thoát</button>
      </div>

      <div className="pr-chips" style={{ padding: '12px 14px 0' }}>
        {DRILL_SOUNDS.map((d) => (
          <button key={d.key} className={`pr-chip ${sound === d.key ? 'active' : ''}`} onClick={() => gen(d.key)} disabled={loading}>
            {d.label}
          </button>
        ))}
      </div>

      {error && <div className="pr-error" style={{ margin: '14px' }}>⚠️ {error}</div>}
      {loading && <div className="pr-loading" style={{ padding: '20px 14px' }}><div className="pr-spinner" /> Đang soạn bài drill…</div>}

      {drill && (
        <div style={{ padding: '0 14px 14px' }}>
          {drill.tip && <div className="pr-savemsg" style={{ marginTop: 14 }}>💡 {drill.tip}</div>}

          {drill.pairs.length > 0 && (
            <section className="pr-section" style={{ marginTop: 16 }}>
              <div className="pr-section-head"><h2>Cặp từ &amp; ví dụ</h2></div>
              <div className="pr-pairs">
                {drill.pairs.map((p, i) => (
                  <div className="pr-pair" key={i}>
                    <div className="pr-pair-words">
                      <WordSpeak word={p.a} speak={speak} onScore={onScore} />
                      {p.b && <><span className="pr-pair-vs">↔</span><WordSpeak word={p.b} speak={speak} onScore={onScore} /></>}
                    </div>
                    {p.note && <div className="pr-pair-note">{p.note}</div>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {drill.sentences.length > 0 && (
            <section className="pr-section">
              <div className="pr-section-head"><h2>Câu luyện</h2></div>
              {drill.sentences.map((s, i) => (
                <PracticeLine key={i} en={s.en} vi={s.vi} onSpeak={speak} onScore={onScore} />
              ))}
            </section>
          )}
        </div>
      )}

      {!drill && !loading && !error && (
        <div className="pr-empty" style={{ padding: '40px 20px' }}>
          <div className="pr-empty-emoji">🔤</div>
          <p>Chọn một âm ở trên để bắt đầu luyện phát âm.</p>
        </div>
      )}
    </div>
  );
}

// ---- Vocab card with on-demand illustration ----

function VocabItem({ v, speak, autoImg }: { v: PracticeVocab; speak: (text: string, lang?: Language) => void; autoImg: boolean }) {
  const [img, setImg] = useState(() => cachedImage(v.term) || '');
  const [show, setShow] = useState(true);
  const [loadingImg, setLoadingImg] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Auto-load the illustration only when the card scrolls near the viewport, so a fresh
  // pack fetches ~visible cards instead of firing all ~20 requests at once. Already-known
  // images (memoized/cached) render instantly via the initial state and need no fetch.
  useEffect(() => {
    if (!autoImg || cachedImage(v.term) !== undefined) return;
    const el = rootRef.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          loadImage(v.term).then((u) => { if (!cancelled) setImg(u); });
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => { cancelled = true; io.disconnect(); };
  }, [v.term, autoImg]);

  async function onImgBtn() {
    if (loadingImg) return;
    if (img) { setShow((s) => !s); return; } // toggle visibility of an already-loaded image
    setLoadingImg(true);
    const u = await loadImage(v.term); // manual fetch when auto is off / none yet
    setImg(u);
    setShow(true);
    setLoadingImg(false);
  }

  const hasImg = !!img;
  return (
    <div className="pr-vocab" ref={rootRef}>
      <div className="pr-vocab-term">
        {v.term}
        <button className="pr-mini" title="Nghe" onClick={() => speak(v.term, 'en')}>🔊</button>
        <button className="pr-mini" title="Phát âm trong video thật (YouGlish)" onClick={() => openUrl(youglishUrl(v.term))}>🎬</button>
        <button
          className="pr-mini"
          title={hasImg ? (show ? 'Ẩn ảnh' : 'Hiện ảnh') : 'Tìm ảnh minh hoạ'}
          onClick={onImgBtn}
        >
          {loadingImg ? '…' : '🖼️'}
        </button>
      </div>
      {img && show && <img className="pr-vocab-img" src={img} alt="" loading="lazy" />}
      {v.ipa && <div className="pr-vocab-ipa">/{v.ipa.replace(/^\/|\/$/g, '')}/</div>}
      <div className="pr-vocab-meaning">{v.meaning}</div>
      {v.example && <div className="pr-vocab-ex">“{v.example}”</div>}
    </div>
  );
}

// ---- Progress dashboard ----

function Dashboard({
  stats,
  daysData,
  dailyStats,
  weak,
  onDrill,
  onExit,
}: {
  stats: PracticeStats;
  daysData: Record<string, { attempts: number; sumScore: number }>;
  dailyStats: { lastDone: string; streak: number };
  weak: Array<{ word: string; misses: number; attempts: number }>;
  onDrill: () => void;
  onExit: () => void;
}) {
  const days = lastNDates(14);
  const maxAttempts = Math.max(1, ...days.map((d) => daysData[d]?.attempts || 0));
  const totalDays = Object.keys(daysData).length;
  const avg = stats.attempts > 0 ? Math.round(stats.sumScore / stats.attempts) : 0;

  return (
    <div className="pr-ielts">
      <div className="pr-chat-head">
        <span>📈 Tiến độ luyện tập</span>
        <button className="pr-act" onClick={onExit}>Thoát</button>
      </div>

      <div className="pr-dash-stats">
        <div className="pr-dash-stat"><b>🔥 {dailyStats.streak}</b><span>Ngày liên tiếp</span></div>
        <div className="pr-dash-stat"><b>🗣️ {stats.attempts}</b><span>Tổng lượt</span></div>
        <div className="pr-dash-stat"><b>📊 {avg}%</b><span>Điểm TB</span></div>
        <div className="pr-dash-stat"><b>📅 {totalDays}</b><span>Ngày đã luyện</span></div>
      </div>

      <div className="pr-dash-chart-title">Hoạt động 14 ngày gần nhất</div>
      <div className="pr-dash-chart">
        {days.map((d) => {
          const cur = daysData[d] || { attempts: 0, sumScore: 0 };
          const h = cur.attempts ? Math.max(8, Math.round((cur.attempts / maxAttempts) * 100)) : 0;
          const dayAvg = cur.attempts ? cur.sumScore / cur.attempts : 0;
          const cls = cur.attempts === 0 ? 'empty' : dayAvg >= 70 ? 'good' : 'mid';
          return (
            <div className="pr-bar-col" key={d} title={`${d}: ${cur.attempts} lượt${cur.attempts ? `, TB ${Math.round(dayAvg)}%` : ''}`}>
              <div className="pr-bar-wrap"><div className={`pr-bar ${cls}`} style={{ height: `${h}%` }} /></div>
              <div className="pr-bar-label">{d.slice(8)}</div>
            </div>
          );
        })}
      </div>

      {weak.length > 0 && (
        <div className="pr-dash-weak">
          <div className="pr-dash-chart-title">🎯 Từ hay đọc/nghe sai ({weak.length})</div>
          <div className="pr-weak-list">
            {weak.slice(0, 15).map((w) => (
              <span className="pr-weak-chip" key={w.word} title={`Sai ${w.misses}/${w.attempts} lần`}>
                {w.word} <b>×{w.misses}</b>
              </span>
            ))}
          </div>
          <button className="pr-generate pr-weak-drill" onClick={onDrill}>
            🎯 Luyện lại {Math.min(weak.length, 12)} từ hay sai
          </button>
        </div>
      )}

      {stats.attempts === 0 && (
        <div className="pr-empty" style={{ padding: '20px' }}>Chưa có dữ liệu — hãy luyện vài câu để xem tiến độ!</div>
      )}
    </div>
  );
}
