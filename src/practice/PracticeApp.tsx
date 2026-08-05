// ============================================
// Topic Practice — speaking & listening from an AI-generated pack
// ============================================

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PracticePack, DialogueLine, Language } from '../types';
import { isSpeechRecognitionSupported, recognizeOnce, scoreSpeech, type SpeechScore } from './speech';

const TOPIC_SUGGESTIONS = ['Nhà hàng', 'Sân bay', 'Phỏng vấn xin việc', 'Khách sạn', 'Mua sắm', 'Cuộc họp', 'Du lịch', 'Đi khám bệnh'];
const LEVELS: { key: string; label: string }[] = [
  { key: 'beginner', label: 'Cơ bản' },
  { key: 'intermediate', label: 'Trung cấp' },
  { key: 'advanced', label: 'Nâng cao' },
];

const SR_SUPPORTED = isSpeechRecognitionSupported();

export default function PracticeApp() {
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState('intermediate');
  const [loading, setLoading] = useState(false);
  const [pack, setPack] = useState<PracticePack | null>(null);
  const [error, setError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

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
    })();
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  function speak(text: string, lang: Language = 'en') {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const uri = lang === 'vi' ? ttsRef.current.vi : ttsRef.current.en;
    const v = voices.find((x) => x.voiceURI === uri);
    if (v) u.voice = v;
    else u.lang = lang === 'vi' ? 'vi-VN' : 'en-US';
    u.rate = ttsRef.current.rate || 0.95;
    window.speechSynthesis.speak(u);
  }

  async function generate(t?: string) {
    const q = (t ?? topic).trim();
    if (!q || loading) return;
    setTopic(q);
    setLoading(true);
    setError('');
    setPack(null);
    setSaveMsg('');
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

  return (
    <div className="pr-app">
      <header className="pr-header">
        <span className="pr-logo">🎯</span>
        <h1>Luyện tập theo chủ đề</h1>
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
          <div className="pr-spinner" /> Đang soạn từ vựng, mẫu câu & hội thoại cho “{topic}”…
        </div>
      )}

      {pack && (
        <div className="pr-content">
          {/* Vocab */}
          {pack.vocab.length > 0 && (
            <section className="pr-section">
              <div className="pr-section-head">
                <h2>Từ vựng</h2>
                <button className="pr-save" onClick={saveVocab}>📇 Lưu tất cả vào sổ</button>
              </div>
              {saveMsg && <div className="pr-savemsg">{saveMsg}</div>}
              <div className="pr-vocab-grid">
                {pack.vocab.map((v, i) => (
                  <div className="pr-vocab" key={i}>
                    <div className="pr-vocab-term">
                      {v.term}
                      <button className="pr-mini" title="Nghe" onClick={() => speak(v.term, 'en')}>🔊</button>
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
                <PracticeLine key={i} en={p.en} vi={p.vi} onSpeak={speak} />
              ))}
            </section>
          )}

          {/* Dialogue */}
          {pack.dialogue.length > 0 && (
            <section className="pr-section">
              <div className="pr-section-head"><h2>Hội thoại</h2></div>
              {pack.dialogue.map((d: DialogueLine, i) => (
                <PracticeLine key={i} en={d.en} vi={d.vi} speaker={d.speaker} onSpeak={speak} />
              ))}
            </section>
          )}
        </div>
      )}

      {!pack && !loading && !error && (
        <div className="pr-empty">
          <div className="pr-empty-emoji">🗣️</div>
          <p>Chọn hoặc nhập một chủ đề để bắt đầu luyện <b>nói</b> &amp; <b>nghe</b>.</p>
        </div>
      )}
    </div>
  );
}

// ---- One practice line: listen (TTS), speak (recognition), dictation ----

function PracticeLine({
  en,
  vi,
  speaker,
  onSpeak,
}: {
  en: string;
  vi: string;
  speaker?: string;
  onSpeak: (text: string, lang?: Language) => void;
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
      setScore(scoreSpeech(en, said));
    } catch {
      setTranscript('(không nghe được — kiểm tra quyền micro)');
    }
    setRecognizing(false);
  }

  function checkDictation() {
    setDictScore(scoreSpeech(en, dictInput));
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
