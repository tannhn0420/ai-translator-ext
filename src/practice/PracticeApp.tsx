// ============================================
// Topic Practice — speaking & listening from an AI-generated pack
// ============================================

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PracticePack, DialogueLine, Language, SpeakingAssessment } from '../types';
import { isSpeechRecognitionSupported, recognizeOnce, scoreSpeech, type SpeechScore, type RecognitionHandle } from './speech';

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

export default function PracticeApp() {
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState('intermediate');
  const [loading, setLoading] = useState(false);
  const [pack, setPack] = useState<PracticePack | null>(null);
  const [error, setError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [stats, setStats] = useState<PracticeStats>(EMPTY_STATS);
  const [rolePlay, setRolePlay] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [ieltsOpen, setIeltsOpen] = useState(false);

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
        if (s?.data) ttsRef.current = { en: s.data.ttsVoiceEn || '', vi: s.data.ttsVoiceVi || '', rate: s.data.ttsRate || 0.95 };
      } catch { /* ignore */ }
      try {
        const r = await chrome.storage.local.get({ practiceStats: EMPTY_STATS });
        setStats(r.practiceStats as PracticeStats);
      } catch { /* ignore */ }
    })();
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  function speak(text: string, lang: Language = 'en', onEnd?: () => void) {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const uri = lang === 'vi' ? ttsRef.current.vi : ttsRef.current.en;
    const v = voices.find((x) => x.voiceURI === uri);
    if (v) u.voice = v;
    else u.lang = lang === 'vi' ? 'vi-VN' : 'en-US';
    u.rate = ttsRef.current.rate || 0.95;
    if (onEnd) u.onend = onEnd;
    window.speechSynthesis.speak(u);
  }

  async function recordScore(score: number) {
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
  }

  async function generate(t?: string) {
    const q = (t ?? topic).trim();
    if (!q || loading) return;
    setTopic(q);
    setLoading(true);
    setError('');
    setPack(null);
    setSaveMsg('');
    setRolePlay(false);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GENERATE_PRACTICE', payload: { topic: q, level } });
      if (res?.success && res.data) setPack(res.data as PracticePack);
      else setError(res?.error || 'Không tạo được bài luyện.');
    } catch {
      setError('Không kết nối được. Kiểm tra API key / reload extension.');
    }
    setLoading(false);
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
        {stats.attempts > 0 && (
          <div className="pr-stats">
            <span>🔥 {stats.streak} ngày</span>
            <span>🗣️ {stats.attempts} lượt</span>
            <span>📊 TB {avg}%</span>
          </div>
        )}
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
        </div>
        <div className="pr-chips">
          {TOPIC_SUGGESTIONS.map((s) => (
            <button key={s} className="pr-chip" onClick={() => generate(s)} disabled={loading}>{s}</button>
          ))}
        </div>
      </div>

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

      {!chatOpen && !ieltsOpen && pack && (
        <div className="pr-content">
          {/* Vocab */}
          {pack.vocab.length > 0 && (
            <section className="pr-section">
              <div className="pr-section-head">
                <h2>Từ vựng</h2>
                <div className="pr-head-actions">
                  <button className="pr-act" onClick={() => openUrl(youtubeSearchUrl(pack.topic))} title="Xem video hội thoại chủ đề này trên YouTube">📺 Video chủ đề</button>
                  <button className="pr-save" onClick={saveVocab}>📇 Lưu tất cả vào sổ</button>
                </div>
              </div>
              {saveMsg && <div className="pr-savemsg">{saveMsg}</div>}
              <div className="pr-vocab-grid">
                {pack.vocab.map((v, i) => (
                  <div className="pr-vocab" key={i}>
                    <div className="pr-vocab-term">
                      {v.term}
                      <button className="pr-mini" title="Nghe" onClick={() => speak(v.term, 'en')}>🔊</button>
                      <button className="pr-mini" title="Phát âm trong video thật (YouGlish)" onClick={() => openUrl(youglishUrl(v.term))}>🎬</button>
                    </div>
                    {v.ipa && <div className="pr-vocab-ipa">/{v.ipa.replace(/^\/|\/$/g, '')}/</div>}
                    <div className="pr-vocab-meaning">{v.meaning}</div>
                    {v.example && <div className="pr-vocab-ex">“{v.example}”</div>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Phrases */}
          {pack.phrases.length > 0 && (
            <section className="pr-section">
              <div className="pr-section-head"><h2>Mẫu câu — luyện nói &amp; nghe</h2></div>
              {pack.phrases.map((p, i) => (
                <PracticeLine key={i} en={p.en} vi={p.vi} onSpeak={speak} onScore={recordScore} />
              ))}
            </section>
          )}

          {/* Dialogue */}
          {pack.dialogue.length > 0 && (
            <section className="pr-section">
              <div className="pr-section-head">
                <h2>Hội thoại</h2>
                {SR_SUPPORTED && !rolePlay && (
                  <button className="pr-save" onClick={() => setRolePlay(true)}>🎭 Đóng vai</button>
                )}
              </div>
              {rolePlay ? (
                <RolePlay dialogue={pack.dialogue} speak={speak} onScore={recordScore} onExit={() => setRolePlay(false)} />
              ) : (
                pack.dialogue.map((d: DialogueLine, i) => (
                  <PracticeLine key={i} en={d.en} vi={d.vi} speaker={d.speaker} onSpeak={speak} onScore={recordScore} />
                ))
              )}
            </section>
          )}
        </div>
      )}

      {!chatOpen && !ieltsOpen && !pack && !loading && !error && (
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

  useEffect(() => {
    mounted.current = true;
    void turn([]); // AI opens the conversation
    return () => {
      mounted.current = false;
      window.speechSynthesis?.cancel();
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
    const { promise } = recognizeOnce('en-US', setInterim);
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
          onClick={speakTurn}
          disabled={thinking || recognizing}
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
  onScore: (score: number) => void;
}) {
  const [recognizing, setRecognizing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [score, setScore] = useState<SpeechScore | null>(null);
  const [dictOpen, setDictOpen] = useState(false);
  const [dictInput, setDictInput] = useState('');
  const [dictScore, setDictScore] = useState<SpeechScore | null>(null);
  const stopRef = useRef<() => void>(() => {});

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
      onScore(sc.score);
    } catch {
      setTranscript('(không nghe được — kiểm tra quyền micro)');
    }
    setRecognizing(false);
  }

  function checkDictation() {
    const sc = scoreSpeech(en, dictInput);
    setDictScore(sc);
    onScore(sc.score);
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
  onScore: (score: number) => void;
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
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.speechSynthesis?.cancel();
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
    const { promise } = recognizeOnce('en-US', setTranscript);
    try {
      const said = await promise;
      if (!mounted.current) return;
      const sc = scoreSpeech(line.en, said);
      setScore(sc);
      setScores((s) => [...s, sc.score]);
      onScore(sc.score);
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
