// ============================================
// Dictation — listen and type a passage / subtitle, validated letter by letter.
// ============================================

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { parseSource, splitSentences } from './lib';
import './dictation.css';

function isTypeable(c: string): boolean {
  return /[A-Za-z0-9]/.test(c);
}

// ---- Letter-by-letter dictation of ONE sentence ----

function LetterDictation({
  target,
  revealTick,
  onComplete,
}: {
  target: string;
  revealTick: number; // bump to reveal the whole answer
  onComplete: (errors: number) => void;
}) {
  const skipAuto = (from: number) => {
    let i = from;
    while (i < target.length && !isTypeable(target[i])) i++;
    return i;
  };
  const [pos, setPos] = useState(() => skipAuto(0));
  const [err, setErr] = useState(false);
  const [errCount, setErrCount] = useState(0);
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Reset when the sentence changes.
  useEffect(() => {
    const start = skipAuto(0);
    setPos(start);
    setErr(false);
    setErrCount(0);
    if (start >= target.length) {
      setDone(true);
      onComplete(0);
    } else {
      setDone(false);
    }
    ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Reveal-all button.
  useEffect(() => {
    if (revealTick > 0) {
      setPos(target.length);
      setDone(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealTick]);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (done) return;
    const k = e.key;
    if (k === 'Backspace') {
      e.preventDefault();
      const start = skipAuto(0);
      if (pos <= start) return;
      let j = pos - 1;
      while (j >= 0 && !isTypeable(target[j])) j--;
      if (j >= start) setPos(j);
      setErr(false);
      return;
    }
    if (k.length !== 1 || !isTypeable(k)) return;
    e.preventDefault();
    if (pos >= target.length) return;
    if (k.toLowerCase() === target[pos].toLowerCase()) {
      const next = skipAuto(pos + 1);
      setPos(next);
      setErr(false);
      if (next >= target.length) {
        setDone(true);
        onComplete(errCount);
      }
    } else {
      setErr(true);
      setErrCount((c) => c + 1);
      window.setTimeout(() => setErr(false), 220);
    }
  }

  return (
    <div
      className={`dc-type ${err ? 'err' : ''} ${done ? 'done' : ''}`}
      tabIndex={0}
      ref={ref}
      onKeyDown={onKey}
    >
      {target.split('').map((c, i) => {
        if (i < pos) return <span key={i} className="dc-ch fill">{c === ' ' ? ' ' : c}</span>;
        if (!isTypeable(c)) return <span key={i} className="dc-ch punc">{c === ' ' ? ' ' : c}</span>;
        return <span key={i} className={`dc-ch gap ${i === pos && !done ? 'cur' : ''}`}>_</span>;
      })}
      {err && <span className="dc-x">✗</span>}
    </div>
  );
}

// ---- App ----

export default function DictationApp() {
  const [raw, setRaw] = useState('');
  const [sentences, setSentences] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [started, setStarted] = useState(false);
  const [reveal, setReveal] = useState(0);
  const [errorsByIdx, setErrorsByIdx] = useState<Record<number, number>>({});
  const [doneByIdx, setDoneByIdx] = useState<Record<number, boolean>>({});

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const ttsRef = useRef({ en: '', rate: 0.95 });
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const loadVoices = () => setVoices(window.speechSynthesis?.getVoices() || []);
    loadVoices();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices;
    (async () => {
      try {
        const s = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        if (s?.data) {
          ttsRef.current = { en: s.data.ttsVoiceEn || '', rate: s.data.ttsRate || 0.95 };
          const th = s.data.theme === 'light' ? 'light' : 'dark';
          setTheme(th);
          document.documentElement.dataset.theme = th;
        }
      } catch { /* ignore */ }
      // Prefill from a stored selection, if any (e.g. opened from the page).
      try {
        const r = await chrome.storage.local.get({ dictationText: '' });
        if (r.dictationText) {
          setRaw(r.dictationText as string);
          await chrome.storage.local.set({ dictationText: '' });
        }
      } catch { /* ignore */ }
    })();
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
      window.speechSynthesis?.cancel();
    };
  }, []);

  function speak(text: string, rate?: number) {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find((x) => x.voiceURI === ttsRef.current.en);
    if (v) u.voice = v;
    else u.lang = 'en-US';
    u.rate = rate ?? ttsRef.current.rate ?? 0.95;
    window.speechSynthesis.speak(u);
  }

  function start() {
    const list = splitSentences(parseSource(raw));
    if (list.length === 0) return;
    setSentences(list);
    setIdx(0);
    setStarted(true);
    setReveal(0);
    setErrorsByIdx({});
    setDoneByIdx({});
    setTimeout(() => speak(list[0]), 250);
  }

  function goto(i: number) {
    if (i < 0 || i >= sentences.length) return;
    setIdx(i);
    setReveal(0);
    setTimeout(() => speak(sentences[i]), 150);
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: { theme: next } }).catch(() => {});
  }

  const total = sentences.length;
  const completed = Object.values(doneByIdx).filter(Boolean).length;
  const totalErrors = Object.values(errorsByIdx).reduce((a, b) => a + b, 0);

  return (
    <div className="dc-app">
      <header className="dc-header">
        <span className="dc-logo">🎧</span>
        <h1>Chép chính tả</h1>
        <div className="dc-header-right">
          {started && <button className="dc-btn ghost" onClick={() => { setStarted(false); window.speechSynthesis?.cancel(); }}>📝 Văn bản khác</button>}
          <button className="dc-btn ghost" onClick={toggleTheme} title="Sáng/tối">{theme === 'dark' ? '☀️' : '🌙'}</button>
        </div>
      </header>

      {!started ? (
        <section className="dc-setup">
          <p className="dc-help">
            Dán <b>đoạn văn</b>, hoặc <b>phụ đề</b> video (SRT / VTT / transcript YouTube) — timestamp sẽ tự được bỏ.
            Nghe từng câu rồi gõ lại; mỗi chữ cái được kiểm tra ngay: gõ sai hiện ✗, gõ đúng thì lộ dần từng chữ.
          </p>
          <textarea
            className="dc-input"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="Dán đoạn văn hoặc phụ đề vào đây…"
            rows={10}
          />
          <button className="dc-btn primary" onClick={start} disabled={!raw.trim()}>🎧 Bắt đầu</button>
        </section>
      ) : completed === total ? (
        <section className="dc-done">
          <div className="dc-done-emoji">🏆</div>
          <h2>Hoàn thành {total} câu!</h2>
          <p>Tổng số lần gõ sai: <b>{totalErrors}</b></p>
          <div className="dc-done-actions">
            <button className="dc-btn primary" onClick={() => goto(0)}>Làm lại từ đầu</button>
            <button className="dc-btn ghost" onClick={() => { setStarted(false); }}>Văn bản khác</button>
          </div>
        </section>
      ) : (
        <section className="dc-run">
          <div className="dc-progress">
            Câu {idx + 1} / {total} · Đã xong {completed} · Gõ sai {totalErrors}
          </div>

          <div className="dc-audio">
            <button className="dc-btn primary" onClick={() => speak(sentences[idx])}>🔊 Nghe</button>
            <button className="dc-btn ghost" onClick={() => speak(sentences[idx], 0.6)}>🐢 Chậm</button>
            <button className="dc-btn ghost" onClick={() => setReveal((r) => r + 1)} title="Hiện đáp án câu này">👁️ Hiện đáp án</button>
          </div>

          <LetterDictation
            key={idx}
            target={sentences[idx]}
            revealTick={reveal}
            onComplete={(errs) => {
              setErrorsByIdx((m) => ({ ...m, [idx]: errs }));
              setDoneByIdx((m) => ({ ...m, [idx]: true }));
            }}
          />

          {doneByIdx[idx] && <div className="dc-ok">✓ Đúng rồi!</div>}

          <div className="dc-nav">
            <button className="dc-btn ghost" onClick={() => goto(idx - 1)} disabled={idx === 0}>← Câu trước</button>
            <button className="dc-btn primary" onClick={() => goto(idx + 1)} disabled={idx >= total - 1}>Câu tiếp →</button>
          </div>
          <p className="dc-tip">Mẹo: bấm vào ô để gõ. <b>Backspace</b> để sửa. Gõ không phân biệt hoa/thường.</p>
        </section>
      )}
    </div>
  );
}
