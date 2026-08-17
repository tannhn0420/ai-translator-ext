// ============================================
// Cloud sync cho extension (Phase 8 phía extension) — dùng CHUNG Supabase
// project với PWA ai-english-companion (bảng cards payload jsonb + meta).
// Chạy từ trang Options. Đồng bộ vocabDeck (chrome.storage.local) ↔ cards,
// và practiceDays/weakWords (merge max-wise) ↔ meta. LWW theo updatedAt||createdAt.
// ============================================

import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import type { VocabCard } from '../types';

const SUPABASE_URL = 'https://gfxdxzeaettwntlwidbs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Sii29K9l3Yj_eJIHFqPBYQ_op8R8t8y';

let client: SupabaseClient | null = null;
export function getClient(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, storageKey: 'aec-ext-auth' },
  });
  return client;
}

export async function getSession(): Promise<Session | null> {
  const { data } = await getClient().auth.getSession();
  return data.session;
}
export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await getClient().auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}
export async function signUp(email: string, password: string): Promise<string | null> {
  const { error } = await getClient().auth.signUp({ email, password });
  return error ? error.message : null;
}
export async function signOut(): Promise<void> {
  await getClient().auth.signOut();
}

// ---- storage helpers (chrome.storage.local) ----

const VOCAB_KEY = 'vocabDeck';
async function getDeck(): Promise<VocabCard[]> {
  const r = await chrome.storage.local.get({ [VOCAB_KEY]: [] });
  return (r[VOCAB_KEY] as VocabCard[]) || [];
}
async function setDeck(deck: VocabCard[]): Promise<void> {
  await chrome.storage.local.set({ [VOCAB_KEY]: deck });
}
async function getLocal<T>(key: string, fallback: T): Promise<T> {
  const r = await chrome.storage.local.get({ [key]: fallback });
  return r[key] as T;
}

// Thẻ từ app có thể kèm `updatedAt` (extension chưa dùng field này) — đọc mềm.
const stamp = (c: VocabCard) => (c as VocabCard & { updatedAt?: number }).updatedAt ?? c.createdAt ?? 0;

// ---- sync state (per user) ----

interface SyncState {
  pulledAt: number;
  pushedAt: number;
  syncedIds: string[]; // để phát hiện thẻ đã xoá cục bộ → tombstone
  lastOkAt?: number;
}
async function loadState(uid: string): Promise<SyncState> {
  const all = await getLocal<Record<string, SyncState>>('aecSyncState', {});
  return all[uid] ?? { pulledAt: 0, pushedAt: 0, syncedIds: [] };
}
async function saveState(uid: string, s: SyncState): Promise<void> {
  const all = await getLocal<Record<string, SyncState>>('aecSyncState', {});
  all[uid] = s;
  await chrome.storage.local.set({ aecSyncState: all });
}

export async function lastSyncedAt(uid: string): Promise<number | undefined> {
  return (await loadState(uid)).lastOkAt;
}

// ---- merge helpers ----

type DayMap = Record<string, { attempts: number; sumScore: number }>;
function mergeDays(a: DayMap, b: DayMap): DayMap {
  const out: DayMap = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const c = out[k];
    out[k] = c
      ? { attempts: Math.max(c.attempts, v.attempts), sumScore: Math.max(c.sumScore, v.sumScore) }
      : v;
  }
  return out;
}
type WeakMap = Record<string, { misses: number; attempts: number }>;
function mergeWeak(a: WeakMap, b: WeakMap): WeakMap {
  const out: WeakMap = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const c = out[k];
    out[k] = c
      ? { misses: Math.max(c.misses, v.misses), attempts: Math.max(c.attempts, v.attempts) }
      : v;
  }
  return out;
}

export interface SyncResult {
  status: 'ok' | 'signed-out' | 'error';
  pulled?: number;
  pushed?: number;
  message?: string;
}

interface RemoteCard {
  id: string;
  payload: VocabCard;
  updated_at: number;
  deleted: boolean;
}

export async function syncNow(): Promise<SyncResult> {
  const session = await getSession();
  if (!session) return { status: 'signed-out' };
  const uid = session.user.id;
  const supa = getClient();

  try {
    const state = await loadState(uid);
    const now = Date.now();
    let deck = await getDeck();
    const byId = new Map(deck.map((c) => [c.id, c]));
    let pulled = 0;
    let pushed = 0;

    // ---- PULL cards (delta) ----
    const { data: rows, error: pullErr } = await supa
      .from('cards')
      .select('id,payload,updated_at,deleted')
      .gt('updated_at', state.pulledAt);
    if (pullErr) throw new Error(pullErr.message);

    let maxPulled = state.pulledAt;
    for (const row of (rows ?? []) as RemoteCard[]) {
      maxPulled = Math.max(maxPulled, row.updated_at);
      const local = byId.get(row.id);
      if (row.deleted) {
        if (local && stamp(local) <= row.updated_at) {
          byId.delete(row.id);
          pulled++;
        }
      } else if (!local || stamp(local) < row.updated_at) {
        byId.set(row.id, row.payload);
        pulled++;
      }
    }
    deck = [...byId.values()];

    // ---- PULL + MERGE meta ----
    const { data: remoteMeta } = await supa.from('meta').select('key,value').in('key', [
      'practiceDays',
      'weakWords',
    ]);
    const rm = new Map((remoteMeta ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
    const localDays = await getLocal<DayMap>('practiceDays', {});
    const localWeak = await getLocal<WeakMap>('weakWords', {});
    const days = mergeDays(localDays, (rm.get('practiceDays') as DayMap) ?? {});
    const weak = mergeWeak(localWeak, (rm.get('weakWords') as WeakMap) ?? {});
    let attempts = 0;
    let sumScore = 0;
    for (const v of Object.values(days)) {
      attempts += v.attempts;
      sumScore += v.sumScore;
    }
    await chrome.storage.local.set({ practiceDays: days, weakWords: weak, practiceStats: { attempts, sumScore } });
    await setDeck(deck);

    // ---- PUSH cards mới/đổi ----
    const dirty = deck.filter((c) => stamp(c) > state.pushedAt);
    if (dirty.length) {
      const { error } = await supa.from('cards').upsert(
        dirty.map((c) => ({
          user_id: uid,
          id: c.id,
          payload: c as unknown as Record<string, unknown>,
          updated_at: stamp(c),
          deleted: false,
        })),
      );
      if (error) throw new Error(error.message);
      pushed += dirty.length;
    }

    // ---- PUSH tombstone: thẻ từng sync nhưng nay không còn trong deck ----
    const currentIds = new Set(deck.map((c) => c.id));
    const removed = state.syncedIds.filter((id) => !currentIds.has(id));
    if (removed.length) {
      const { error } = await supa.from('cards').upsert(
        removed.map((id) => ({ user_id: uid, id, payload: {}, updated_at: now, deleted: true })),
      );
      if (error) throw new Error(error.message);
      pushed += removed.length;
    }

    // ---- PUSH meta bản merge ----
    await supa.from('meta').upsert([
      { user_id: uid, key: 'practiceDays', value: days, updated_at: now },
      { user_id: uid, key: 'weakWords', value: weak, updated_at: now },
      { user_id: uid, key: 'practiceStats', value: { attempts, sumScore }, updated_at: now },
    ]);

    await saveState(uid, {
      pulledAt: maxPulled,
      pushedAt: now,
      syncedIds: [...currentIds],
      lastOkAt: now,
    });
    return { status: 'ok', pulled, pushed };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
