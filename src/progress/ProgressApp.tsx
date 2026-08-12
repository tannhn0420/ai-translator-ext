// ============================================
// Progress — a unified dashboard: XP/level, streak, stats, 14-day activity, badges.
// ============================================
// Read-only: aggregates existing data (vocab deck, practice stats/days, weak
// words, dictation sessions, translation count) — no extra logging needed.

import { useEffect, useState } from 'react';
import type { VocabCard } from '../types';
import './progress.css';

interface DictationSession {
  sentences: string[];
  doneByIdx?: Record<number, boolean>;
  score?: number;
  finished?: boolean;
  updatedAt?: number;
}

interface Data {
  words: number;
  learned: number;
  due: number;
  attempts: number;
  avgPractice: number;
  streak: number;
  dictSessions: number;
  dictFinished: number;
  dictSentences: number;
  bestDict: number;
  translations: number;
  xp: number;
  level: number;
  xpInLevel: number;
  xpForLevel: number;
  days: { date: string; count: number }[];
  weak: { word: string; misses: number; attempts: number }[];
}

const XP_PER_LEVEL = 500;
const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);
function lastNDates(n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(dayStr(now - i * 86_400_000));
  return out;
}

const BADGES: { icon: string; name: string; ok: (d: Data) => boolean }[] = [
  { icon: '🌱', name: 'Bắt đầu', ok: (d) => d.words >= 1 || d.attempts >= 1 },
  { icon: '📚', name: '10 từ', ok: (d) => d.words >= 10 },
  { icon: '🎓', name: '50 từ', ok: (d) => d.words >= 50 },
  { icon: '🏛️', name: '100 từ', ok: (d) => d.words >= 100 },
  { icon: '🔥', name: 'Streak 3', ok: (d) => d.streak >= 3 },
  { icon: '⚡', name: 'Streak 7', ok: (d) => d.streak >= 7 },
  { icon: '💎', name: 'Streak 30', ok: (d) => d.streak >= 30 },
  { icon: '🎧', name: 'Chép chính tả', ok: (d) => d.dictFinished >= 1 },
  { icon: '🗣️', name: 'Luyện nói ×10', ok: (d) => d.attempts >= 10 },
  { icon: '🎯', name: 'Điểm cao 90+', ok: (d) => d.bestDict >= 90 },
];

export default function ProgressApp() {
  const [data, setData] = useState<Data | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const [vocabRes, settingsRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_VOCAB' }).catch(() => null),
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).catch(() => null),
    ]);
    const deck = ((vocabRes?.data as VocabCard[]) || []);
    const s = settingsRes?.data || {};
    const th = s.theme === 'light' ? 'light' : 'dark';
    setTheme(th);
    document.documentElement.dataset.theme = th;

    const local = await chrome.storage.local.get({
      practiceStats: { attempts: 0, sumScore: 0 },
      practiceDays: {},
      weakWords: {},
      dictationSessions: [],
    });
    const pStats = local.practiceStats as { attempts: number; sumScore: number };
    const pDays = (local.practiceDays || {}) as Record<string, { attempts: number; sumScore: number }>;
    const weakWords = (local.weakWords || {}) as Record<string, { misses: number; attempts: number }>;
    const sessions = (local.dictationSessions || []) as DictationSession[];

    const now = Date.now();
    const words = deck.length;
    const learned = deck.filter((c) => (c.reps || 0) >= 2).length;
    const due = deck.filter((c) => (c.due || 0) <= now).length;
    const attempts = pStats.attempts || 0;
    const avgPractice = attempts > 0 ? Math.round((pStats.sumScore || 0) / attempts) : 0;

    const dictFinished = sessions.filter((x) => x.finished).length;
    const dictSentences = sessions.reduce((a, x) => a + Object.values(x.doneByIdx || {}).filter(Boolean).length, 0);
    const bestDict = sessions.reduce((m, x) => Math.max(m, x.score || 0), 0);

    const translations = Number(s.totalTranslations) || 0;

    // Unified per-day activity: practice + dictation updates + words added.
    const perDay: Record<string, number> = {};
    for (const [d, v] of Object.entries(pDays)) perDay[d] = (perDay[d] || 0) + (v.attempts || 0);
    for (const x of sessions) if (x.updatedAt) { const d = dayStr(x.updatedAt); perDay[d] = (perDay[d] || 0) + 1; }
    for (const c of deck) if (c.createdAt) { const d = dayStr(c.createdAt); perDay[d] = (perDay[d] || 0) + 1; }

    // Streak: consecutive days up to today (or yesterday) with activity.
    let streak = 0;
    for (let i = 0; ; i++) {
      const d = dayStr(now - i * 86_400_000);
      if (perDay[d]) streak++;
      else if (i === 0) continue; // today may be empty; still allow the streak to count from yesterday
      else break;
    }

    const days = lastNDates(14).map((date) => ({ date, count: perDay[date] || 0 }));
    const weak = Object.entries(weakWords)
      .map(([word, v]) => ({ word, misses: v.misses || 0, attempts: v.attempts || 0 }))
      .filter((w) => w.misses > 0)
      .sort((a, b) => b.misses - a.misses)
      .slice(0, 12);

    const xp = words * 5 + attempts * 3 + dictSentences * 2 + translations;
    const level = Math.floor(xp / XP_PER_LEVEL) + 1;

    setData({
      words, learned, due, attempts, avgPractice, streak,
      dictSessions: sessions.length, dictFinished, dictSentences, bestDict, translations,
      xp, level, xpInLevel: xp % XP_PER_LEVEL, xpForLevel: XP_PER_LEVEL,
      days, weak,
    });
  }

  if (!data) return <div className="pg-app"><div className="pg-loading">Đang tải…</div></div>;

  const maxDay = Math.max(1, ...data.days.map((d) => d.count));
  const pct = Math.round((data.xpInLevel / data.xpForLevel) * 100);

  return (
    <div className="pg-app">
      <header className="pg-header">
        <span className="pg-logo">📊</span>
        <h1>Tiến độ học tập</h1>
      </header>

      {/* XP / level + streak */}
      <div className="pg-top">
        <div className="pg-level-card">
          <div className="pg-level-badge">Lv {data.level}</div>
          <div className="pg-level-info">
            <div className="pg-xp">{data.xp.toLocaleString()} XP</div>
            <div className="pg-bar"><div className="pg-bar-fill" style={{ width: `${pct}%` }} /></div>
            <div className="pg-xp-sub">{data.xpInLevel}/{data.xpForLevel} tới cấp {data.level + 1}</div>
          </div>
        </div>
        <div className="pg-streak-card">
          <div className="pg-streak-num">🔥 {data.streak}</div>
          <div className="pg-streak-sub">ngày liên tiếp</div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="pg-stats">
        <div className="pg-stat"><b>{data.words}</b><span>Từ đã lưu</span></div>
        <div className="pg-stat"><b>{data.learned}</b><span>Đã thuộc</span></div>
        <div className="pg-stat"><b>{data.due}</b><span>Đến hạn ôn</span></div>
        <div className="pg-stat"><b>{data.attempts}</b><span>Lượt luyện nói</span></div>
        <div className="pg-stat"><b>{data.avgPractice}%</b><span>Điểm nói TB</span></div>
        <div className="pg-stat"><b>{data.dictFinished}</b><span>Bài chép xong</span></div>
        <div className="pg-stat"><b>{data.bestDict}%</b><span>Điểm chép cao nhất</span></div>
        <div className="pg-stat"><b>{data.translations}</b><span>Lượt dịch</span></div>
      </div>

      {/* 14-day activity */}
      <div className="pg-section-title">Hoạt động 14 ngày gần nhất</div>
      <div className="pg-chart">
        {data.days.map((d) => (
          <div className="pg-bar-col" key={d.date} title={`${d.date}: ${d.count} hoạt động`}>
            <div className="pg-bar-v" style={{ height: `${d.count ? 12 + (d.count / maxDay) * 76 : 3}%`, opacity: d.count ? 1 : 0.25 }} />
            <span className="pg-bar-day">{d.date.slice(8)}</span>
          </div>
        ))}
      </div>

      {/* Badges */}
      <div className="pg-section-title">Huy hiệu</div>
      <div className="pg-badges">
        {BADGES.map((b) => {
          const earned = b.ok(data);
          return (
            <div className={`pg-badge ${earned ? 'on' : 'off'}`} key={b.name}>
              <div className="pg-badge-icon">{b.icon}</div>
              <div className="pg-badge-name">{b.name}</div>
            </div>
          );
        })}
      </div>

      {/* Weak words */}
      {data.weak.length > 0 && (
        <>
          <div className="pg-section-title">Từ hay sai (luyện thêm)</div>
          <div className="pg-weak">
            {data.weak.map((w) => (
              <span className="pg-weak-chip" key={w.word}>{w.word} <b>×{w.misses}</b></span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
