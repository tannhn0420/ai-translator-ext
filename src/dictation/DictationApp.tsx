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

/** Extract readable article text from fetched HTML: pick the container with the most
 *  paragraph text (a lightweight readability heuristic), then join its paragraphs. */
function extractArticleFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,iframe,svg,nav,header,footer,aside,form,button,figure,figcaption').forEach((e) => e.remove());
  const paraLen = (el: Element) => {
    let sum = 0;
    el.querySelectorAll('p').forEach((p) => {
      const t = (p.textContent || '').trim();
      if (t.length >= 30) sum += t.length;
    });
    return sum;
  };
  let best: Element = doc.body;
  let bestScore = paraLen(doc.body);
  doc.querySelectorAll('article, main, [role="main"], section, div').forEach((el) => {
    if (el.querySelectorAll('p').length < 2) return;
    const s = paraLen(el);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  });
  const paras = Array.from(best.querySelectorAll('p'))
    .map((p) => (p.textContent || '').trim())
    .filter((t) => t.length >= 30);
  const text = paras.length ? paras.join('\n\n') : (best.textContent || '');
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

const RANDOM_TOPICS = [
  'a surprising animal fact', 'daily life in a big city', 'how coffee is made',
  'the history of the internet', 'healthy eating habits', 'a famous invention',
  'space exploration', 'learning a new language', 'the benefits of walking',
  'how the weather works', 'a memorable trip', 'the importance of sleep',
  'renewable energy', 'the life of bees', 'ancient Egypt', 'how music affects mood',
  'the ocean and its creatures', 'volunteering in the community', 'the future of cars',
  'a traditional festival', 'why we dream', 'the story of chocolate',
  'staying focused while studying', 'famous landmarks around the world',
];

interface Session {
  sentences: string[];
  idx: number;
  doneByIdx: Record<number, boolean>;
  errorsByIdx: Record<number, number>;
  viByIdx: Record<number, string>;
}

// ---- Letter-by-letter dictation of ONE sentence ----

function LetterDictation({
  target,
  revealTick,
  onComplete,
}: {
  target: string;
  revealTick: number;
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

  const typed = Math.max(0, [...target.slice(0, pos)].filter(isTypeable).length);
  const totalGaps = [...target].filter(isTypeable).length;

  return (
    <div className={`dc-type ${err ? 'err' : ''} ${done ? 'done' : ''}`} tabIndex={0} ref={ref} onKeyDown={onKey}>
      <div className="dc-line">
        {target.split('').map((c, i) => {
          if (i < pos) return <span key={i} className="dc-ch fill">{c}</span>;
          if (!isTypeable(c)) return <span key={i} className="dc-ch punc">{c}</span>;
          return <span key={i} className={`dc-ch gap ${i === pos && !done ? 'cur' : ''}`}>_</span>;
        })}
      </div>
      <div className="dc-mini">{done ? 'done' : `${typed}/${totalGaps}`}</div>
      {err && <span className="dc-x">✗</span>}
    </div>
  );
}

// ---- App ----

export default function DictationApp() {
  const [raw, setRaw] = useState('');
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [msg, setMsg] = useState('');
  const [genTopic, setGenTopic] = useState('');
  const [genLevel, setGenLevel] = useState('intermediate');
  const [genWords, setGenWords] = useState(150);
  const [generating, setGenerating] = useState(false);

  const [sentences, setSentences] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [started, setStarted] = useState(false);
  const [reveal, setReveal] = useState(0);
  const [errorsByIdx, setErrorsByIdx] = useState<Record<number, number>>({});
  const [doneByIdx, setDoneByIdx] = useState<Record<number, boolean>>({});
  const [viByIdx, setViByIdx] = useState<Record<number, string>>({});
  const [resume, setResume] = useState<Session | null>(null);
  const sentencesRef = useRef<string[]>([]);

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
      try {
        const r = await chrome.storage.local.get({ dictationText: '', dictationSession: null });
        if (r.dictationText) {
          setRaw(r.dictationText as string);
          await chrome.storage.local.set({ dictationText: '' });
        }
        const sess = r.dictationSession as Session | null;
        if (sess && sess.sentences?.length) {
          const allDone = sess.sentences.every((_, i) => sess.doneByIdx?.[i]);
          if (!allDone) setResume(sess);
        }
      } catch { /* ignore */ }
    })();
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
      window.speechSynthesis?.cancel();
    };
  }, []);

  // Persist progress so the exercise can be resumed later (or in a pop-out window).
  useEffect(() => {
    if (!started || sentences.length === 0) return;
    chrome.storage.local.set({ dictationSession: { sentences, idx, doneByIdx, errorsByIdx, viByIdx } }).catch(() => {});
  }, [started, sentences, idx, doneByIdx, errorsByIdx, viByIdx]);

  function clearSession() {
    chrome.storage.local.remove('dictationSession').catch(() => {});
  }

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

  async function ensureVi(i: number) {
    const list = sentencesRef.current;
    if (!list[i] || viByIdx[i] !== undefined) return;
    setViByIdx((m) => ({ ...m, [i]: '…' }));
    try {
      const res = await chrome.runtime.sendMessage({ type: 'TRANSLATE_BATCH', payload: { items: [{ i: 0, text: list[i] }], targetLang: 'vi' } });
      const vi = res?.data?.[0] || '';
      setViByIdx((m) => ({ ...m, [i]: vi || '(no translation)' }));
    } catch {
      setViByIdx((m) => ({ ...m, [i]: '(translation error)' }));
    }
  }

  function beginWith(list: string[]) {
    sentencesRef.current = list;
    setSentences(list);
    setIdx(0);
    setStarted(true);
    setReveal(0);
    setErrorsByIdx({});
    setDoneByIdx({});
    setViByIdx({});
    setMsg('');
    setResume(null);
    setTimeout(() => speak(list[0]), 250);
    void ensureVi(0);
  }

  function start() {
    const list = splitSentences(parseSource(raw));
    if (list.length === 0) {
      setMsg('No sentences found — check the text.');
      return;
    }
    beginWith(list);
  }

  function doResume() {
    if (!resume) return;
    sentencesRef.current = resume.sentences;
    setSentences(resume.sentences);
    setIdx(resume.idx || 0);
    setDoneByIdx(resume.doneByIdx || {});
    setErrorsByIdx(resume.errorsByIdx || {});
    setViByIdx(resume.viByIdx || {});
    setStarted(true);
    setReveal(0);
    setResume(null);
    setTimeout(() => speak(resume.sentences[resume.idx || 0]), 250);
    void ensureVi(resume.idx || 0);
  }

  function goto(i: number) {
    if (i < 0 || i >= sentences.length) return;
    setIdx(i);
    setReveal(0);
    setTimeout(() => speak(sentences[i]), 150);
    void ensureVi(i);
  }

  function exitToSetup() {
    // Progress is already saved; just leave the run view so it can be resumed.
    window.speechSynthesis?.cancel();
    setStarted(false);
    setResume({ sentences, idx, doneByIdx, errorsByIdx, viByIdx });
  }

  function newText() {
    window.speechSynthesis?.cancel();
    clearSession();
    setStarted(false);
    setResume(null);
    setSentences([]);
  }

  async function generatePassage() {
    setGenerating(true);
    setMsg('');
    const topic = genTopic.trim() || RANDOM_TOPICS[Math.floor(Math.random() * RANDOM_TOPICS.length)];
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GENERATE_PASSAGE', payload: { topic, level: genLevel, words: genWords } });
      if (!res?.success || !res.data?.passage) {
        setMsg(res?.error || 'Could not generate a passage.');
      } else {
        setRaw(res.data.passage);
        const wc = res.data.passage.split(/\s+/).filter(Boolean).length;
        setMsg(`Generated ~${wc} words (topic: ${topic}). Review, then Start.`);
      }
    } catch {
      setMsg('Error while generating.');
    }
    setGenerating(false);
  }

  async function fetchArticle() {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) { setMsg('URL must start with http:// or https://'); return; }
    setFetching(true);
    setMsg('');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'FETCH_ARTICLE', payload: { url: u } });
      if (!res?.success || !res.data?.html) {
        setMsg(res?.error || 'Could not fetch the page.');
      } else {
        const text = extractArticleFromHtml(res.data.html);
        if (text.length < 60) setMsg('Fetched the page but found little article text (it may be JS-rendered).');
        else { setRaw(text); setMsg(`Fetched ~${text.length} characters. Review, then Start.`); }
      }
    } catch {
      setMsg('Error while fetching.');
    }
    setFetching(false);
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: { theme: next } }).catch(() => {});
  }

  // Pop out the whole app into an always-on-top Document Picture-in-Picture window.
  async function popOut() {
    const rootEl = document.getElementById('root');
    const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: object) => Promise<Window> } }).documentPictureInPicture;
    if (rootEl && dpip?.requestWindow) {
      try {
        const pip = await dpip.requestWindow({ width: 480, height: 660 });
        document.querySelectorAll('link[rel="stylesheet"], style').forEach((n) => pip.document.head.appendChild(n.cloneNode(true)));
        pip.document.documentElement.dataset.theme = theme;
        pip.document.body.appendChild(rootEl);
        pip.addEventListener('pagehide', () => {
          document.body.appendChild(rootEl);
        });
        return;
      } catch { /* fall through to a plain popup window */ }
    }
    window.open(location.href, '_blank', 'popup,width=520,height=700');
  }

  const total = sentences.length;
  const completed = Object.values(doneByIdx).filter(Boolean).length;
  const totalErrors = Object.values(errorsByIdx).reduce((a, b) => a + b, 0);
  const pct = total ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="dc-app">
      <header className="dc-header">
        <span className="dc-logo">🎧</span>
        <h1>Dictation</h1>
        <div className="dc-header-right">
          {started && <button className="dc-btn ghost sm" onClick={exitToSetup} title="Exit (progress is saved)">← Exit</button>}
          <button className="dc-btn ghost sm" onClick={popOut} title="Open in a floating window (Picture-in-Picture)">⧉ Pop-out</button>
          <button className="dc-btn ghost sm" onClick={toggleTheme} title="Light / dark">{theme === 'dark' ? '☀️' : '🌙'}</button>
        </div>
      </header>

      {!started ? (
        <section className="dc-setup">
          {resume && (
            <div className="dc-resume">
              <div>
                <b>Unfinished passage</b>
                <div className="dc-resume-sub">Sentence {(resume.idx || 0) + 1} of {resume.sentences.length}</div>
              </div>
              <div className="dc-resume-actions">
                <button className="dc-btn primary" onClick={doResume}>Resume</button>
                <button className="dc-btn ghost" onClick={() => { clearSession(); setResume(null); }}>Discard</button>
              </div>
            </div>
          )}

          <p className="dc-help">
            Generate a passage with AI, fetch an article by link, or paste your own text / subtitles
            (SRT / VTT / transcript — timestamps are removed). Listen to each sentence and type it back;
            every letter is checked instantly. The Vietnamese meaning is shown to help you guess.
          </p>

          <div className="dc-gen">
            <div className="dc-gen-title">🎲 Let AI write a passage</div>
            <div className="dc-gen-row">
              <input
                className="dc-url"
                value={genTopic}
                onChange={(e) => setGenTopic(e.target.value)}
                placeholder="Topic (blank = random)"
                onKeyDown={(e) => { if (e.key === 'Enter') generatePassage(); }}
              />
              <select className="dc-select" value={genLevel} onChange={(e) => setGenLevel(e.target.value)}>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
              <select className="dc-select" value={genWords} onChange={(e) => setGenWords(Number(e.target.value))}>
                <option value={100}>~100 words</option>
                <option value={150}>~150 words</option>
                <option value={200}>~200 words</option>
              </select>
              <button className="dc-btn primary" onClick={generatePassage} disabled={generating}>
                {generating ? 'Generating…' : '🎲 Generate'}
              </button>
            </div>
          </div>

          <div className="dc-or"><span>or</span></div>

          <div className="dc-url-row">
            <input
              className="dc-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste an article link (https://…)"
              onKeyDown={(e) => { if (e.key === 'Enter') fetchArticle(); }}
            />
            <button className="dc-btn ghost" onClick={fetchArticle} disabled={fetching || !url.trim()}>
              {fetching ? 'Fetching…' : '🌐 Fetch'}
            </button>
          </div>

          <textarea
            className="dc-input"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="…or paste a passage / subtitles here."
            rows={8}
          />
          {msg && <div className="dc-msg">{msg}</div>}
          <button className="dc-btn primary lg" onClick={start} disabled={!raw.trim()}>🎧 Start</button>
        </section>
      ) : completed === total ? (
        <section className="dc-done">
          <div className="dc-done-emoji">🏆</div>
          <h2>Finished {total} sentences!</h2>
          <p>Total mistakes: <b>{totalErrors}</b></p>
          <div className="dc-done-actions">
            <button className="dc-btn primary" onClick={() => { clearSession(); goto(0); }}>Restart</button>
            <button className="dc-btn ghost" onClick={newText}>New text</button>
          </div>
        </section>
      ) : (
        <section className="dc-run">
          <div className="dc-bar"><div className="dc-bar-fill" style={{ width: `${pct}%` }} /></div>
          <div className="dc-progress">
            Sentence {idx + 1} / {total} · Done {completed} · Mistakes {totalErrors}
          </div>

          <div className="dc-vi" title="Vietnamese meaning (hint)">🇻🇳 {viByIdx[idx] || '…'}</div>

          <div className="dc-audio">
            <button className="dc-btn primary" onClick={() => speak(sentences[idx])}>🔊 Play</button>
            <button className="dc-btn ghost" onClick={() => speak(sentences[idx], 0.6)}>🐢 Slow</button>
            <button className="dc-btn ghost" onClick={() => setReveal((r) => r + 1)} title="Reveal this sentence">👁️ Reveal</button>
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

          {doneByIdx[idx] && <div className="dc-ok">✓ Correct!</div>}

          <div className="dc-nav">
            <button className="dc-btn ghost" onClick={() => goto(idx - 1)} disabled={idx === 0}>← Prev</button>
            <button className="dc-btn primary" onClick={() => goto(idx + 1)} disabled={idx >= total - 1}>Next →</button>
          </div>
          <p className="dc-tip">Click the box and type. <b>Backspace</b> to fix · not case-sensitive · progress is saved automatically.</p>
        </section>
      )}
    </div>
  );
}
