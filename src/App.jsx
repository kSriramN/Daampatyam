import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Heart, Home as HomeIcon, Search as SearchIcon, User, Plus, Calendar,
  Camera, Mic, Video, X, ChevronLeft, Lock, BookOpen, Square,
  Trash2, ShieldCheck, KeyRound, Copy, Check, AlertTriangle, Download, Upload,
  Star, Smile, MessageCircle, StickyNote, TrendingUp, CheckSquare, ListChecks,
  Sparkles, LogOut, Mail, Gift, Users
} from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { storageGet, storageSet, setBackendMode, getBackendMode, migrateLocalToAccount } from "./storage.js";

/* ---------------------------------------------------------------
   CRYPTO HELPERS (unchanged from v1 — AES-256-GCM, passphrase +
   12-word recovery phrase both unwrap the same random master key)
----------------------------------------------------------------*/
const enc = new TextEncoder();
const dec = new TextDecoder();

function bufToB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64ToBuf(b64) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }

async function deriveKeyFromSecret(secret, saltB64) {
  const salt = b64ToBuf(saltB64);
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}
async function aesEncryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { iv: bufToB64(iv), data: bufToB64(cipher) };
}
async function aesDecryptBytes(key, blob) {
  const iv = b64ToBuf(blob.iv);
  const data = b64ToBuf(blob.data);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new Uint8Array(plain);
}
async function encryptJSON(masterKey, obj) { return aesEncryptBytes(masterKey, enc.encode(JSON.stringify(obj))); }
async function decryptJSON(masterKey, blob) { const bytes = await aesDecryptBytes(masterKey, blob); return JSON.parse(dec.decode(bytes)); }
async function importRawKey(bytes) { return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]); }

const RECOVERY_WORDS = [
  "anchor","autumn","banyan","blossom","breeze","candle","chapter","cinder","comet","coral",
  "dawn","dune","ember","falcon","feather","fern","garden","glacier","harbor","haven",
  "horizon","indigo","ivory","jasmine","juniper","kindle","lagoon","lantern","laurel","linen",
  "lotus","maple","meadow","mellow","mist","monsoon","moss","nectar","nimbus","ocean",
  "opal","orbit","orchid","paper","pebble","petal","pine","prairie","quartz","quiet",
  "raven","reef","ripple","river","saffron","sail","sapphire","shore","sienna","silk",
  "sonnet","spark","spruce","story","sunrise","sunset","tender","thistle","tide","tulip",
  "twilight","umbra","valley","velvet","violet","willow","zephyr","amber","aster","birch"
];
function generateRecoveryPhrase() {
  const idx = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(idx, (n) => RECOVERY_WORDS[n % RECOVERY_WORDS.length]).join(" ");
}

/* ---------------------------------------------------------------
   CONSTANTS & HELPERS
----------------------------------------------------------------*/
const TAGS = [
  { id: "funny", label: "Funny", emoji: "😄" },
  { id: "romantic", label: "Romantic", emoji: "💕" },
  { id: "family", label: "Family", emoji: "👪" },
  { id: "trips", label: "Trips", emoji: "🧳" },
  { id: "celebrations", label: "Celebrations", emoji: "🎉" },
  { id: "daily-life", label: "Daily Life", emoji: "☕" },
];
const tagInfo = (id) => TAGS.find((t) => t.id === id) || TAGS[5];

const MOODS = [
  { id: "great", emoji: "😄", label: "Great" },
  { id: "good", emoji: "🙂", label: "Good" },
  { id: "okay", emoji: "😐", label: "Okay" },
  { id: "low", emoji: "😔", label: "Low" },
  { id: "stressed", emoji: "😣", label: "Stressed" },
];

function todayISO() { return new Date().toISOString().slice(0, 10); }
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function daysUntilAnnual(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (next < todayMid) next = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
  return Math.round((next - todayMid) / 86400000);
}

function pronounSet(gender) {
  if (gender === "he") return { subject: "he", object: "him", possessive: "his" };
  if (gender === "she") return { subject: "she", object: "her", possessive: "her" };
  if (gender === "they") return { subject: "they", object: "them", possessive: "their" };
  return null;
}
// Returns the right word for partner, e.g. refer(profile,'possessive') -> "her" or "Alex's"
function refer(profile, form) {
  const p = pronounSet(profile?.gender);
  if (p) return p[form];
  const name = profile?.partnerName || "them";
  return form === "possessive" ? `${name}'s` : name;
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function computeScore({ chapters, counters, todos, promises, bucketlist }) {
  const chaptersPts = chapters.length * 5;
  const complimentPts = (counters?.compliments || 0) * 1;
  const laughPts = (counters?.laughs || 0) * 1;
  const todosDone = todos.filter((t) => t.done).length;
  const todoPts = todosDone * 2;
  const promisesKept = promises.reduce((s, p) => s + (p.keptCount || 0), 0);
  const promisesBroken = promises.reduce((s, p) => s + (p.brokenCount || 0), 0);
  const promisePts = promisesKept * 10 - promisesBroken * 5;
  const bucketDone = bucketlist.filter((b) => b.done).length;
  const bucketPts = bucketDone * 15;
  const total = chaptersPts + complimentPts + laughPts + todoPts + promisePts + bucketPts;
  return {
    total,
    breakdown: [
      { label: "Chapters written", count: chapters.length, pts: chaptersPts },
      { label: "Compliments given", count: counters?.compliments || 0, pts: complimentPts },
      { label: "Made them laugh", count: counters?.laughs || 0, pts: laughPts },
      { label: "To-dos done", count: todosDone, pts: todoPts },
      { label: "Promises kept", count: promisesKept, pts: promisesKept * 10 },
      { label: "Promises broken", count: promisesBroken, pts: -promisesBroken * 5 },
      { label: "Bucket list done", count: bucketDone, pts: bucketPts },
    ],
  };
}
function scoreTier(total) {
  if (total < 50) return "Just Getting Started";
  if (total < 150) return "Warm & Growing";
  if (total < 300) return "Strong Bond";
  return "Soulmates";
}

function getTodaysSuggestion({ chapters, moods, profile }) {
  const suggestions = [];
  const lastDate = chapters[0]?.date;
  const daysSinceChapter = lastDate ? Math.floor((Date.now() - new Date(lastDate + "T00:00:00")) / 86400000) : 99;
  if (daysSinceChapter >= 5) suggestions.push("It's been a while since your last chapter — write about one small moment from today.");
  const loggedToday = moods.some((m) => m.date === todayISO());
  if (!loggedToday) suggestions.push(`Log how ${refer(profile, "object")} is feeling today — it only takes a few seconds.`);
  suggestions.push(`Give ${refer(profile, "object")} a genuine compliment today, and log it in Quick Actions.`);
  suggestions.push(`Ask ${refer(profile, "object")} about one thing on ${refer(profile, "possessive")} wishlist.`);
  suggestions.push("Plan one small surprise this week — check your To-Do list.");
  const dayIndex = Math.floor(Date.now() / 86400000);
  return suggestions[dayIndex % suggestions.length];
}

/* ---------------------------------------------------------------
   MAIN APP
----------------------------------------------------------------*/
export default function App() {
  // phase: loading | welcome | login | setup | enter | recover |
  //        onboard-partner | onboard-first-chapter | app
  const [phase, setPhase] = useState("loading");
  const [masterKey, setMasterKey] = useState(null);
  const [meta, setMeta] = useState(null);
  const [profile, setProfile] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [counters, setCounters] = useState({ compliments: 0, laughs: 0 });
  const [moods, setMoods] = useState([]);
  const [notes, setNotes] = useState([]);
  const [todos, setTodos] = useState([]);
  const [promises, setPromises] = useState([]);
  const [bucketlist, setBucketlist] = useState([]);
  const [reminders, setReminders] = useState([]);

  const [tab, setTab] = useState("home"); // home | todo | chapters | profile
  const [activeChapter, setActiveChapter] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showOnThisDay, setShowOnThisDay] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const [showMoodLog, setShowMoodLog] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showScoreDetail, setShowScoreDetail] = useState(false);
  const [showPartnerProfile, setShowPartnerProfile] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }

  // Generic encrypted persist helper — every save goes through here so we
  // can track in-flight writes and block locking/logout mid-save (the fix
  // for the "locking deletes recent memories" race condition).
  const persist = useCallback(async (key, newValue, setter) => {
    setter(newValue);
    setPendingSaves((n) => n + 1);
    try {
      const blob = await encryptJSON(masterKey, newValue);
      await storageSet(key, blob);
    } catch (e) {
      console.error("save failed", key, e);
      showToast("Couldn't save — check your connection and try again.");
    } finally {
      setPendingSaves((n) => Math.max(0, n - 1));
    }
  }, [masterKey]);

  /* ---------------- BOOT ---------------- */
  useEffect(() => {
    (async () => {
      const mode = localStorage.getItem("daampatyam-mode");
      if (!mode) { setPhase("welcome"); return; }
      setBackendMode(mode);
      if (mode === "account") {
        if (!supabase) { setPhase("login"); return; }
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setPhase("login"); return; }
      }
      const m = await storageGet("meta");
      if (!m) setPhase("setup"); else { setMeta(m); setPhase("enter"); }
    })();
  }, []);

  const loadAllData = useCallback(async (key) => {
    const [encProfile, encChapters, encCounters, encMoods, encNotes, encTodos, encPromises, encBucket, encReminders] = await Promise.all([
      storageGet("profile"), storageGet("chapters"), storageGet("counters"), storageGet("moods"),
      storageGet("notes"), storageGet("todos"), storageGet("promises"), storageGet("bucketlist"), storageGet("reminders"),
    ]);
    const safeDecrypt = async (blob, fallback) => {
      if (!blob) return fallback;
      try { return await decryptJSON(key, blob); } catch (e) { return fallback; }
    };
    setProfile(await safeDecrypt(encProfile, null));
    setChapters(await safeDecrypt(encChapters, []));
    setCounters(await safeDecrypt(encCounters, { compliments: 0, laughs: 0 }));
    setMoods(await safeDecrypt(encMoods, []));
    setNotes(await safeDecrypt(encNotes, []));
    setTodos(await safeDecrypt(encTodos, []));
    setPromises(await safeDecrypt(encPromises, []));
    setBucketlist(await safeDecrypt(encBucket, []));
    setReminders(await safeDecrypt(encReminders, []));
  }, []);

  function lockApp() {
    if (pendingSaves > 0) { showToast("Still saving — try again in a moment."); return; }
    setMasterKey(null);
    setProfile(null); setChapters([]); setCounters({ compliments: 0, laughs: 0 });
    setMoods([]); setNotes([]); setTodos([]); setPromises([]); setBucketlist([]); setReminders([]);
    setTab("home");
    setPhase("enter");
  }

  async function logOutToWelcome() {
    if (pendingSaves > 0) { showToast("Still saving — try again in a moment."); return; }
    if (supabase) { try { await supabase.auth.signOut(); } catch (e) { /* ignore */ } }
    localStorage.removeItem("daampatyam-mode");
    setMasterKey(null); setMeta(null);
    setProfile(null); setChapters([]); setCounters({ compliments: 0, laughs: 0 });
    setMoods([]); setNotes([]); setTodos([]); setPromises([]); setBucketlist([]); setReminders([]);
    setTab("home");
    setPhase("welcome");
  }

  
  async function deleteAccountForever() {
    if (pendingSaves > 0) { showToast("Still saving — try again in a moment."); return; }
    try {
      const { error } = await supabase.rpc("delete_own_account");
      if (error) throw error;
      localStorage.removeItem("daampatyam-mode");
      setMasterKey(null); setMeta(null);
      setProfile(null); setChapters([]); setCounters({ compliments: 0, laughs: 0 });
      setMoods([]); setNotes([]); setTodos([]); setPromises([]); setBucketlist([]); setReminders([]);
      setTab("home");
      setPhase("welcome");
    } catch (e) {
      showToast("Couldn't delete account — please try again.");
    }
  }

  /* ---------------- FEEDBACK (once per install, until captured) ---------------- */
  useEffect(() => {
    if (phase !== "app") return;
    let cancelled = false;
    (async () => {
      const existing = await storageGet("feedback");
      if (!existing?.captured && !cancelled) setTimeout(() => setShowFeedback(true), 1200);
    })();
    return () => { cancelled = true; };
  }, [phase]);

  async function submitFeedback(rating, comment) {
    await storageSet("feedback", { captured: true, rating, comment, submittedAt: new Date().toISOString() });
    setShowFeedback(false);
    if (supabase) {
      try {
        let deviceId = await storageGet("device-id");
        if (!deviceId) { deviceId = crypto.randomUUID(); await storageSet("device-id", deviceId); }
        await supabase.from("feedback").insert({ rating, comment: comment || null, device_id: deviceId });
      } catch (e) { console.error("feedback sync failed", e); }
    }
  }

  /* ---------------- EXPORT / IMPORT (Guest Mode backup file) ---------------- */
  async function exportData() {
    const keys = ["meta", "profile", "chapters", "counters", "moods", "notes", "todos", "promises", "bucketlist", "reminders"];
    const values = await Promise.all(keys.map((k) => storageGet(k)));
    const payload = { app: "daampatyam", exportedAt: new Date().toISOString() };
    keys.forEach((k, i) => { payload[k] = values[i]; });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `daampatyam-backup-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  async function importData(payload) {
    const keys = ["meta", "profile", "chapters", "counters", "moods", "notes", "todos", "promises", "bucketlist", "reminders"];
    for (const k of keys) { if (payload[k] !== undefined) await storageSet(k, payload[k]); }
    setMasterKey(null); setProfile(null); setChapters([]); setCounters({ compliments: 0, laughs: 0 });
    setMoods([]); setNotes([]); setTodos([]); setPromises([]); setBucketlist([]); setReminders([]);
    setTab("home");
    setMeta(payload.meta || null);
    setPhase("enter");
  }

  /* ---------------- GUEST -> ACCOUNT MIGRATION ---------------- */
  async function migrateToAccount() {
    const keys = ["meta", "profile", "chapters", "counters", "moods", "notes", "todos", "promises", "bucketlist", "reminders", "feedback"];
    await migrateLocalToAccount(keys);
    localStorage.setItem("daampatyam-mode", "account");
    setBackendMode("account");
    showToast("Synced! Your data now backs up to your account.");
  }

  /* ---------------- ACTION HELPERS (feed the score) ---------------- */
  const bumpCounter = (type) => {
    const updated = { ...counters, [type]: (counters[type] || 0) + 1 };
    persist("counters", updated, setCounters);
    showToast(type === "compliments" ? "Compliment logged 💐" : "Laugh logged 😄");
  };
  const logMood = (moodId, note) => {
    const today = todayISO();
    const rest = moods.filter((m) => m.date !== today);
    const updated = [{ date: today, mood: moodId, note }, ...rest].slice(0, 90);
    persist("moods", updated, setMoods);
    showToast("Mood logged");
  };
  const addNote = (text) => {
    const updated = [{ id: crypto.randomUUID(), text, createdAt: new Date().toISOString() }, ...notes];
    persist("notes", updated, setNotes);
    showToast("Note added");
  };
  const deleteNote = (id) => persist("notes", notes.filter((n) => n.id !== id), setNotes);

  const addTodo = (text, period) => {
    const updated = [{ id: crypto.randomUUID(), text, period, done: false }, ...todos];
    persist("todos", updated, setTodos);
  };
  const toggleTodo = (id) => {
    const updated = todos.map((t) => t.id === id ? { ...t, done: !t.done, completedAt: !t.done ? new Date().toISOString() : null } : t);
    persist("todos", updated, setTodos);
  };
  const deleteTodo = (id) => persist("todos", todos.filter((t) => t.id !== id), setTodos);

  const addPromise = (text) => {
    const updated = [{ id: crypto.randomUUID(), text, keptCount: 0, brokenCount: 0 }, ...promises];
    persist("promises", updated, setPromises);
  };
  const markPromise = (id, status) => {
    const updated = promises.map((p) => p.id === id
      ? { ...p, keptCount: p.keptCount + (status === "kept" ? 1 : 0), brokenCount: p.brokenCount + (status === "broken" ? 1 : 0) }
      : p);
    persist("promises", updated, setPromises);
    showToast(status === "kept" ? "Marked as kept +10" : "Marked as broken");
  };
  const deletePromise = (id) => persist("promises", promises.filter((p) => p.id !== id), setPromises);

  const addBucketItem = (text) => {
    const updated = [{ id: crypto.randomUUID(), text, done: false }, ...bucketlist];
    persist("bucketlist", updated, setBucketlist);
  };
  const toggleBucketItem = (id) => {
    const updated = bucketlist.map((b) => b.id === id ? { ...b, done: !b.done } : b);
    persist("bucketlist", updated, setBucketlist);
  };
  const deleteBucketItem = (id) => persist("bucketlist", bucketlist.filter((b) => b.id !== id), setBucketlist);

  const addReminder = (label, date) => {
    const updated = [{ id: crypto.randomUUID(), label, date }, ...reminders];
    persist("reminders", updated, setReminders);
  };
  const deleteReminder = (id) => persist("reminders", reminders.filter((r) => r.id !== id), setReminders);

  /* ---------------- PHASE ROUTING ---------------- */
  if (phase === "loading") return <CenterMessage>Loading…</CenterMessage>;

  if (phase === "welcome") {
    return (
      <WelcomeScreen
        onGuest={async () => {
          localStorage.setItem("daampatyam-mode", "guest");
          setBackendMode("guest");
          const m = await storageGet("meta");
          if (!m) setPhase("setup"); else { setMeta(m); setPhase("enter"); }
        }}
        onLogin={() => {
          localStorage.setItem("daampatyam-mode", "account");
          setBackendMode("account");
          setPhase("login");
        }}
      />
    );
  }

  if (phase === "login") {
    return (
      <LoginScreen
        onLoggedIn={async () => {
          const m = await storageGet("meta");
          if (!m) setPhase("setup"); else { setMeta(m); setPhase("enter"); }
        }}
        onBack={() => { localStorage.removeItem("daampatyam-mode"); setPhase("welcome"); }}
      />
    );
  }

  if (phase === "setup") {
    return (
      <SetupPassphrase
        onDone={async (mKey, newMeta) => {
          setMeta(newMeta);
          setMasterKey(mKey);
          const existingProfile = await storageGet("profile");
          setPhase(existingProfile ? "app" : "onboard-partner");
        }}
      />
    );
  }

  if (phase === "enter") {
    return (
      <EnterPassphrase
        meta={meta}
        onUnlocked={async (mKey) => {
          setMasterKey(mKey);
          await loadAllData(mKey);
          const existingProfile = await storageGet("profile");
          setPhase(existingProfile ? "app" : "onboard-partner");
        }}
        onForgot={() => setPhase("recover")}
      />
    );
  }

  if (phase === "recover") {
    return (
      <RecoverAccess
        meta={meta}
        onRecovered={async (mKey, updatedMeta) => {
          setMeta(updatedMeta);
          setMasterKey(mKey);
          await loadAllData(mKey);
          const existingProfile = await storageGet("profile");
          setPhase(existingProfile ? "app" : "onboard-partner");
        }}
        onCancel={() => setPhase("enter")}
      />
    );
  }

  if (phase === "onboard-partner") {
    return (
      <OnboardPartner
        onContinue={async (p) => {
          await persist("profile", p, setProfile);
          setPhase("onboard-first-chapter");
        }}
      />
    );
  }

  if (phase === "onboard-first-chapter") {
    return (
      <OnboardFirstChapter
        onAdd={() => { setShowAdd(true); setPhase("app"); }}
        onSkip={() => setPhase("app")}
      />
    );
  }

  /* ---------------- MAIN APP ---------------- */
  const score = computeScore({ chapters, counters, todos, promises, bucketlist });

  return (
    <div style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh" }}>
      <GlobalStyle />
      <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "var(--bg)", position: "relative", paddingBottom: 84 }}>

        {tab === "home" && !showOnThisDay && (
          <HomeScreen
            profile={profile} chapters={chapters} counters={counters} moods={moods} notes={notes} reminders={reminders}
            score={score}
            onOpenChapter={setActiveChapter}
            onOpenOnThisDay={() => setShowOnThisDay(true)}
            onOpenReminders={() => setShowReminders(true)}
            onOpenMoodLog={() => setShowMoodLog(true)}
            onOpenNotes={() => setShowNotes(true)}
            onOpenScoreDetail={() => setShowScoreDetail(true)}
            onBumpCounter={bumpCounter}
            onGoChapters={() => setTab("chapters")}
          />
        )}
        {tab === "home" && showOnThisDay && (
          <OnThisDayScreen chapters={chapters} onBack={() => setShowOnThisDay(false)} onOpenChapter={(c) => { setShowOnThisDay(false); setActiveChapter(c); }} />
        )}

        {tab === "todo" && (
          <TodoScreen
            todos={todos} promises={promises} bucketlist={bucketlist}
            onAddTodo={addTodo} onToggleTodo={toggleTodo} onDeleteTodo={deleteTodo}
            onAddPromise={addPromise} onMarkPromise={markPromise} onDeletePromise={deletePromise}
            onAddBucketItem={addBucketItem} onToggleBucketItem={toggleBucketItem} onDeleteBucketItem={deleteBucketItem}
          />
        )}

        {tab === "chapters" && (
          <ChaptersScreen chapters={chapters} onOpenChapter={setActiveChapter}
            onToggleFavorite={(id) => persist("chapters", chapters.map((c) => c.id === id ? { ...c, favorite: !c.favorite } : c), setChapters)}
          />
        )}

        {tab === "profile" && !showPartnerProfile && !showScoreDetail && (
          <ProfileScreen
            profile={profile} chapterCount={chapters.length}
            mode={getBackendMode()}
                        onLock={lockApp}
            onLogOut={logOutToWelcome}
            onDeleteAccount={deleteAccountForever}
            onExport={exportData} onImport={importData}
            onOpenPartnerProfile={() => setShowPartnerProfile(true)}
            onOpenScoreDetail={() => setShowScoreDetail(true)}
            onMigrateToAccount={migrateToAccount}
          />
        )}
        {tab === "profile" && showPartnerProfile && (
          <PartnerProfileScreen
            profile={profile}
            onBack={() => setShowPartnerProfile(false)}
            onSave={(p) => { persist("profile", { ...profile, ...p }, setProfile); showToast("Partner profile saved"); setShowPartnerProfile(false); }}
          />
        )}
        {tab === "profile" && showScoreDetail && (
          <ScoreDetailScreen score={score} onBack={() => setShowScoreDetail(false)} />
        )}

        {!showOnThisDay && (
          <button className="fab" onClick={() => setShowAdd(true)} aria-label="Add chapter"><Plus size={26} color="#fff" /></button>
        )}

        <TabBar tab={tab} setTab={(t) => { setTab(t); setShowOnThisDay(false); setShowPartnerProfile(false); setShowScoreDetail(false); }} />

        {showReminders && (
          <RemindersModal profile={profile} reminders={reminders} onAdd={addReminder} onDelete={deleteReminder} onClose={() => setShowReminders(false)} />
        )}
        {showMoodLog && (
          <MoodLogModal onClose={() => setShowMoodLog(false)} onSave={(m, n) => { logMood(m, n); setShowMoodLog(false); }} />
        )}
        {showNotes && (
          <NotesModal notes={notes} onAdd={addNote} onDelete={deleteNote} onClose={() => setShowNotes(false)} />
        )}

        {activeChapter && (
          <ChapterDetail
            chapter={chapters.find((c) => c.id === activeChapter.id) || activeChapter}
            onClose={() => setActiveChapter(null)}
            onToggleFavorite={(id) => persist("chapters", chapters.map((c) => c.id === id ? { ...c, favorite: !c.favorite } : c), setChapters)}
            onDelete={async (id) => {
              await persist("chapters", chapters.filter((c) => c.id !== id), setChapters);
              showToast("Chapter deleted");
              setActiveChapter(null);
            }}
          />
        )}

        {showAdd && (
          <AddChapter
            onClose={() => setShowAdd(false)}
            onSave={async (chapter) => {
              await persist("chapters", [{ ...chapter, id: crypto.randomUUID(), favorite: false }, ...chapters], setChapters);
              showToast("Chapter saved ✓");
              setShowAdd(false);
            }}
          />
        )}

        {showFeedback && <FeedbackPrompt onSubmit={submitFeedback} onDismiss={() => setShowFeedback(false)} />}
        {toast && <Toast message={toast} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   SHARED STYLE / PRIMITIVES
----------------------------------------------------------------*/
function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');
      :root {
        --bg:#FBF4F0; --surface:#FFFFFF; --text:#33262B; --muted:#8C7B80;
        --accent:#C1596B; --accent-dark:#A6425A; --gold:#D9A05B; --line:#EFE2DC;
        --font-display:'Fraunces', serif; --font-body:'Inter', sans-serif;
      }
      * { box-sizing: border-box; }
      h1,h2,h3, .display { font-family: var(--font-display); color: var(--text); }
      .fab { position:absolute; right:20px; bottom:92px; width:56px; height:56px; border-radius:999px; background:var(--accent); border:none; box-shadow:0 8px 20px rgba(193,89,107,0.35); display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:20; }
      .fab:active { transform: scale(0.94); }
      button { font-family: var(--font-body); }
      input, textarea { font-family: var(--font-body); }
      ::placeholder { color: #B9ABAF; }
    `}</style>
  );
}
function CenterMessage({ children }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#FBF4F0", color: "#33262B", fontFamily: "Inter, sans-serif" }}>
      <GlobalStyle />{children}
    </div>
  );
}
function AuthShell({ icon, title, subtitle, children }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <GlobalStyle />
      <div style={{ width: "100%", maxWidth: 360, background: "var(--surface)", borderRadius: 20, padding: 32, boxShadow: "0 20px 50px rgba(51,38,43,0.08)" }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>{icon}</div>
        <h2 className="display" style={{ textAlign: "center", fontSize: 22, fontWeight: 600, margin: "8px 0 6px" }}>{title}</h2>
        {subtitle && <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 13.5, margin: "0 0 22px", lineHeight: 1.5 }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "#FDFAF8", fontSize: 14.5, color: "var(--text)", marginBottom: 12, outline: "none" };
const primaryBtn = { width: "100%", padding: "13px 14px", borderRadius: 12, border: "none", background: "var(--accent)", color: "#fff", fontSize: 14.5, fontWeight: 600, cursor: "pointer" };
const outlineBtn = { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "transparent", color: "var(--text)", fontSize: 14, cursor: "pointer" };

function Toast({ message }) {
  return (
    <div style={{ position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)", background: "#33262B", color: "#fff", padding: "10px 18px", borderRadius: 999, fontSize: 12.5, zIndex: 60, boxShadow: "0 8px 20px rgba(0,0,0,0.2)" }}>
      {message}
    </div>
  );
}

/* ---------------------------------------------------------------
   WELCOME (Guest vs Login)
----------------------------------------------------------------*/
function WelcomeScreen({ onGuest, onLogin }) {
  return (
    <AuthShell icon={<Heart size={30} color="var(--accent)" />} title="Daampatyam" subtitle="Every beautiful marriage is made of countless little moments.">
      <button style={primaryBtn} onClick={onLogin}>Log In / Sign Up →</button>
      <button style={{ ...outlineBtn, marginTop: 10 }} onClick={onGuest}>Continue as Guest</button>
      <p style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>
        Guest mode keeps everything on this device only — you can create an account and bring your data with you later.
      </p>
    </AuthShell>
  );
}

/* ---------------------------------------------------------------
   LOGIN (Supabase Auth email/password)
----------------------------------------------------------------*/
function LoginScreen({ onLoggedIn, onBack }) {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!supabase) { setError("Backend isn't configured yet — set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY."); return; }
    setBusy(true); setError(""); setInfo("");
    try {
      if (mode === "login") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        onLoggedIn();
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        if (data.session) { onLoggedIn(); }
        else { setInfo("Check your email to confirm your account, then log in."); setMode("login"); }
      }
    } catch (e) {
      setError(e.message || "Something went wrong.");
    }
    setBusy(false);
  }

  return (
    <AuthShell icon={<Mail size={28} color="var(--accent)" />} title={mode === "login" ? "Log in" : "Create your account"} subtitle="This links your encrypted story to your account so it syncs across devices.">
      <input style={inputStyle} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input style={inputStyle} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} />
      {error && <p style={{ color: "var(--accent-dark)", fontSize: 12.5, marginTop: -4, marginBottom: 10 }}>{error}</p>}
      {info && <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: -4, marginBottom: 10 }}>{info}</p>}
      <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={handleSubmit}>
        {busy ? "Please wait…" : mode === "login" ? "Log In →" : "Create Account →"}
      </button>
      <button style={{ ...outlineBtn, marginTop: 10 }} onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setInfo(""); }}>
        {mode === "login" ? "New here? Create an account" : "Already have an account? Log in"}
      </button>
      <button style={{ ...outlineBtn, marginTop: 10, border: "none" }} onClick={onBack}>← Back</button>
    </AuthShell>
  );
}

/* ---------------------------------------------------------------
   SETUP PASSPHRASE (first run on this account/device)
----------------------------------------------------------------*/
function SetupPassphrase({ onDone }) {
  const [step, setStep] = useState("passphrase");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [recoveryPhrase] = useState(() => generateRecoveryPhrase());
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [confirmedSaved, setConfirmedSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const phraseInputRef = useRef(null);

  async function handleCreatePassphrase() {
    if (pass.length < 4) { setError("Use at least 4 characters."); return; }
    if (pass !== confirm) { setError("Passphrases don't match."); return; }
    setError(""); setStep("recovery");
  }

  async function handleCopy() {
    setCopyFailed(false);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(recoveryPhrase);
        setCopied(true); setTimeout(() => setCopied(false), 1500);
        return;
      }
      throw new Error("clipboard API unavailable");
    } catch (e) {
      const el = phraseInputRef.current;
      if (el) {
        el.focus(); el.select();
        try {
          const ok = document.execCommand("copy");
          if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); return; }
        } catch (e2) { /* fall through */ }
      }
      setCopyFailed(true);
    }
  }

  async function handleFinish() {
    setBusy(true);
    try {
      const masterKeyRaw = crypto.getRandomValues(new Uint8Array(32));
      const mKey = await importRawKey(masterKeyRaw);
      const saltP = bufToB64(crypto.getRandomValues(new Uint8Array(16)));
      const saltR = bufToB64(crypto.getRandomValues(new Uint8Array(16)));
      const keyP = await deriveKeyFromSecret(pass, saltP);
      const keyR = await deriveKeyFromSecret(recoveryPhrase, saltR);
      const wrappedByPassphrase = await aesEncryptBytes(keyP, masterKeyRaw);
      const wrappedByRecovery = await aesEncryptBytes(keyR, masterKeyRaw);
      const newMeta = { saltP, saltR, wrappedByPassphrase, wrappedByRecovery };
      await storageSet("meta", newMeta);
      onDone(mKey, newMeta);
    } catch (e) {
      setError("Something went wrong setting up encryption. Please try again.");
      setBusy(false);
    }
  }

  if (step === "passphrase") {
    return (
      <AuthShell icon={<Heart size={30} color="var(--accent)" />} title="Protect your story" subtitle="Set a passphrase or PIN. It encrypts every chapter — no one, not even Daampatyam, can read your story without it.">
        <input style={inputStyle} type="password" placeholder="Create a passphrase" value={pass} onChange={(e) => setPass(e.target.value)} />
        <input style={inputStyle} type="password" placeholder="Confirm passphrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <p style={{ color: "var(--accent-dark)", fontSize: 12.5, marginTop: -4, marginBottom: 10 }}>{error}</p>}
        <button style={primaryBtn} onClick={handleCreatePassphrase}>Continue</button>
      </AuthShell>
    );
  }
  return (
    <AuthShell icon={<KeyRound size={30} color="var(--gold)" />} title="Your recovery phrase" subtitle="If you ever forget your passphrase, this 12-word phrase is the only way back into your story. Save it somewhere safe.">
      <div style={{ background: "#FBF4EC", border: "1px dashed var(--gold)", borderRadius: 12, padding: 16, fontFamily: "monospace", fontSize: 13.5, lineHeight: 1.9, color: "var(--text)", marginBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px 10px" }}>
        {recoveryPhrase.split(" ").map((w, i) => (<span key={i}><span style={{ color: "var(--muted)" }}>{i + 1}.</span> {w}</span>))}
      </div>
      <input ref={phraseInputRef} readOnly value={recoveryPhrase} style={{ position: "absolute", left: -9999, opacity: 0 }} aria-hidden="true" tabIndex={-1} />
      <button style={{ ...outlineBtn, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: copyFailed ? 6 : 14 }} onClick={handleCopy}>
        {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy phrase"}
      </button>
      {copyFailed && <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>Copying isn't available here — please select-and-copy the 12 words above manually.</p>}
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5, color: "var(--muted)", marginBottom: 16, lineHeight: 1.5 }}>
        <input type="checkbox" checked={confirmedSaved} onChange={(e) => setConfirmedSaved(e.target.checked)} style={{ marginTop: 2 }} />
        I've saved this phrase somewhere safe. I understand Daampatyam cannot recover it for me.
      </label>
      {error && <p style={{ color: "var(--accent-dark)", fontSize: 12.5, marginTop: -6, marginBottom: 10 }}>{error}</p>}
      <button style={{ ...primaryBtn, opacity: confirmedSaved && !busy ? 1 : 0.5 }} disabled={!confirmedSaved || busy} onClick={handleFinish}>
        {busy ? "Setting up…" : "Begin Your Story →"}
      </button>
    </AuthShell>
  );
}

/* ---------------------------------------------------------------
   ENTER PASSPHRASE
----------------------------------------------------------------*/
function EnterPassphrase({ meta, onUnlocked, onForgot }) {
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleUnlock() {
    setBusy(true); setError("");
    try {
      const keyP = await deriveKeyFromSecret(pass, meta.saltP);
      const masterKeyRaw = await aesDecryptBytes(keyP, meta.wrappedByPassphrase);
      const mKey = await importRawKey(masterKeyRaw);
      onUnlocked(mKey);
    } catch (e) {
      setError("Incorrect passphrase. Please try again.");
      setBusy(false);
    }
  }
  return (
    <AuthShell icon={<Lock size={28} color="var(--accent)" />} title="Welcome back" subtitle="Enter your passphrase to unlock your story.">
      <input style={inputStyle} type="password" placeholder="Passphrase" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleUnlock()} />
      {error && <p style={{ color: "var(--accent-dark)", fontSize: 12.5, marginTop: -4, marginBottom: 10 }}>{error}</p>}
      <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={handleUnlock}>{busy ? "Unlocking…" : "Unlock →"}</button>
      <button style={{ ...outlineBtn, marginTop: 10 }} onClick={onForgot}>Forgot your passphrase?</button>
    </AuthShell>
  );
}

/* ---------------------------------------------------------------
   RECOVER ACCESS
----------------------------------------------------------------*/
function RecoverAccess({ meta, onRecovered, onCancel }) {
  const [phrase, setPhrase] = useState("");
  const [step, setStep] = useState("phrase");
  const [masterKeyRaw, setMasterKeyRaw] = useState(null);
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleVerify() {
    setBusy(true); setError("");
    try {
      const normalized = phrase.trim().toLowerCase().split(/\s+/).join(" ");
      const keyR = await deriveKeyFromSecret(normalized, meta.saltR);
      const raw = await aesDecryptBytes(keyR, meta.wrappedByRecovery);
      setMasterKeyRaw(raw); setStep("newpass");
    } catch (e) { setError("That recovery phrase doesn't match. Check the spelling and order."); }
    setBusy(false);
  }
  async function handleSetNewPassphrase() {
    if (newPass.length < 4) { setError("Use at least 4 characters."); return; }
    if (newPass !== confirmPass) { setError("Passphrases don't match."); return; }
    setBusy(true);
    try {
      const saltP = bufToB64(crypto.getRandomValues(new Uint8Array(16)));
      const keyP = await deriveKeyFromSecret(newPass, saltP);
      const wrappedByPassphrase = await aesEncryptBytes(keyP, masterKeyRaw);
      const updatedMeta = { ...meta, saltP, wrappedByPassphrase };
      await storageSet("meta", updatedMeta);
      const mKey = await importRawKey(masterKeyRaw);
      onRecovered(mKey, updatedMeta);
    } catch (e) { setError("Something went wrong. Please try again."); setBusy(false); }
  }

  if (step === "phrase") {
    return (
      <AuthShell icon={<AlertTriangle size={28} color="var(--gold)" />} title="Recover access" subtitle="Enter your 12-word recovery phrase, separated by spaces.">
        <textarea style={{ ...inputStyle, minHeight: 80, resize: "none" }} placeholder="word1 word2 word3 ..." value={phrase} onChange={(e) => setPhrase(e.target.value)} />
        {error && <p style={{ color: "var(--accent-dark)", fontSize: 12.5, marginTop: -4, marginBottom: 10 }}>{error}</p>}
        <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={handleVerify}>{busy ? "Checking…" : "Verify phrase"}</button>
        <button style={{ ...outlineBtn, marginTop: 10 }} onClick={onCancel}>← Back</button>
      </AuthShell>
    );
  }
  return (
    <AuthShell icon={<KeyRound size={28} color="var(--accent)" />} title="Set a new passphrase" subtitle="Your recovery phrase checked out. Choose a new passphrase to unlock your story from now on.">
      <input style={inputStyle} type="password" placeholder="New passphrase" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
      <input style={inputStyle} type="password" placeholder="Confirm new passphrase" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} />
      {error && <p style={{ color: "var(--accent-dark)", fontSize: 12.5, marginTop: -4, marginBottom: 10 }}>{error}</p>}
      <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={handleSetNewPassphrase}>{busy ? "Saving…" : "Save & unlock →"}</button>
    </AuthShell>
  );
}

/* ---------------------------------------------------------------
   ONBOARDING: PARTNER (+ gender/pronouns)
----------------------------------------------------------------*/
function OnboardPartner({ onContinue }) {
  const [name, setName] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [anniversary, setAnniversary] = useState("");
  const [gender, setGender] = useState("");

  const genderOptions = [
    { id: "she", label: "She / Her" },
    { id: "he", label: "He / Him" },
    { id: "they", label: "They / Them" },
    { id: "name", label: "Just use their name" },
  ];

  return (
    <AuthShell icon={<Heart size={28} color="var(--accent)" />} title="Let's start with you" subtitle="Tell us about your partner. You can edit this later in settings.">
      <input style={inputStyle} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      <input style={inputStyle} placeholder="Partner's name" value={partnerName} onChange={(e) => setPartnerName(e.target.value)} />
      <label style={{ fontSize: 12, color: "var(--muted)" }}>Anniversary date</label>
      <input style={{ ...inputStyle, marginTop: 4 }} type="date" value={anniversary} onChange={(e) => setAnniversary(e.target.value)} />
      <label style={{ fontSize: 12, color: "var(--muted)" }}>How should we refer to your partner?</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0 16px" }}>
        {genderOptions.map((g) => (
          <button key={g.id} onClick={() => setGender(g.id === "name" ? "name" : g.id)} style={{
            padding: "7px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
            border: gender === g.id ? "1px solid var(--accent)" : "1px solid var(--line)",
            background: gender === g.id ? "var(--accent)" : "transparent",
            color: gender === g.id ? "#fff" : "var(--text)",
          }}>{g.label}</button>
        ))}
      </div>
      <button style={primaryBtn} onClick={() => onContinue({ name: name || "You", partnerName: partnerName || "Partner", anniversary, gender })}>Continue →</button>
    </AuthShell>
  );
}
function OnboardFirstChapter({ onAdd, onSkip }) {
  return (
    <AuthShell icon={<BookOpen size={28} color="var(--accent)" />} title="Every story begins with a chapter" subtitle="What's one memory you'd like to preserve today?">
      <button style={primaryBtn} onClick={onAdd}>Add First Chapter →</button>
      <button style={{ ...outlineBtn, marginTop: 10 }} onClick={onSkip}>Maybe later</button>
    </AuthShell>
  );
}

/* ---------------------------------------------------------------
   TAB BAR (Home · To-Do · Chapters · Me)
----------------------------------------------------------------*/
function TabBar({ tab, setTab }) {
  const item = (id, Icon, label) => (
    <button onClick={() => setTab(id)} style={{
      background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
      cursor: "pointer", color: tab === id ? "var(--accent)" : "var(--muted)", fontSize: 10.5, fontWeight: tab === id ? 600 : 400, flex: 1, padding: "6px 0"
    }}>
      <Icon size={20} />{label}
    </button>
  );
  return (
    <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "var(--surface)", borderTop: "1px solid var(--line)", display: "flex", padding: "6px 8px calc(6px + env(safe-area-inset-bottom))", zIndex: 15 }}>
      {item("home", HomeIcon, "Home")}
      {item("todo", ListChecks, "To-Do")}
      {item("chapters", BookOpen, "Chapters")}
      {item("profile", User, "Me")}
    </div>
  );
}

/* ---------------------------------------------------------------
   HOME DASHBOARD
----------------------------------------------------------------*/
function computeOnThisDay(chapters) {
  const now = new Date();
  return chapters.filter((c) => {
    if (!c.date) return false;
    const d = new Date(c.date + "T00:00:00");
    return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() !== now.getFullYear();
  });
}

function HomeScreen({ profile, chapters, counters, moods, notes, reminders, score, onOpenChapter, onOpenOnThisDay, onOpenReminders, onOpenMoodLog, onOpenNotes, onOpenScoreDetail, onBumpCounter, onGoChapters }) {
  const onThisDay = computeOnThisDay(chapters);
  const suggestion = getTodaysSuggestion({ chapters, moods, profile });
  const annivDays = daysUntilAnnual(profile?.anniversary);
  const bdayDays = daysUntilAnnual(profile?.partnerBirthday);
  const upcoming = [
    bdayDays !== null ? { label: `${cap(refer(profile, "possessive"))} birthday`, days: bdayDays } : null,
    annivDays !== null ? { label: "Anniversary", days: annivDays } : null,
    ...reminders.map((r) => ({ label: r.label, days: daysUntilAnnual(r.date) })),
  ].filter(Boolean).sort((a, b) => a.days - b.days);

  const last7Moods = moods.slice(0, 7);

  return (
    <div style={{ padding: "20px 18px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h1 className="display" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Daampatyam</h1>
        <ShieldCheck size={18} color="var(--accent)" />
      </div>

      <button onClick={onOpenScoreDetail} style={{ width: "100%", textAlign: "left", background: "var(--text)", color: "#fff", border: "none", borderRadius: 14, padding: "14px 16px", marginBottom: 14, cursor: "pointer" }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Relationship Score: {score.total}</div>
        <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{scoreTier(score.total)} — tap for breakdown →</div>
      </button>

      <div className="label" style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>Today's Suggestion</div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#FBF4EC", border: "1px solid #EFE2CB", borderRadius: 14, padding: "12px 14px", marginBottom: 16 }}>
        <Sparkles size={16} color="var(--gold)" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>{suggestion}</p>
      </div>

      {upcoming.length > 0 && (
        <button onClick={onOpenReminders} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10, background: "#F4E4DC", border: "1px solid #E9CFC0", borderRadius: 14, padding: "12px 14px", marginBottom: 16, cursor: "pointer" }}>
          <Gift size={18} color="var(--accent-dark)" />
          <span style={{ fontSize: 12.5, color: "var(--text)" }}>
            <strong>{upcoming[0].label}</strong> in {upcoming[0].days} day{upcoming[0].days === 1 ? "" : "s"}{upcoming.length > 1 ? ` · +${upcoming.length - 1} more` : ""} →
          </span>
        </button>
      )}

      <div className="label" style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Quick Actions</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        <button onClick={() => onBumpCounter("laughs")} style={quickActionBtn}><Smile size={16} /> Made {refer(profile, "object")} laugh</button>
        <button onClick={() => onBumpCounter("compliments")} style={quickActionBtn}><MessageCircle size={16} /> Gave a compliment</button>
        <button onClick={onOpenMoodLog} style={quickActionBtn}><TrendingUp size={16} /> Log {refer(profile, "possessive")} mood</button>
        <button onClick={onOpenNotes} style={quickActionBtn}><StickyNote size={16} /> Add a note</button>
      </div>

      {last7Moods.length > 0 && (
        <>
          <div className="label" style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>{cap(refer(profile, "possessive"))} Mood (recent)</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {last7Moods.map((m, i) => (
              <div key={i} title={m.date} style={{ fontSize: 18 }}>{MOODS.find((x) => x.id === m.mood)?.emoji || "•"}</div>
            ))}
          </div>
        </>
      )}

      {notes.length > 0 && (
        <button onClick={onOpenNotes} style={{ width: "100%", textAlign: "left", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", marginBottom: 16, cursor: "pointer" }}>
          <span style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>Important Notes</span>
          <p style={{ fontSize: 12, margin: "4px 0 0" }}>{notes.slice(0, 2).map((n) => n.text).join(" · ")}{notes.length > 2 ? ` +${notes.length - 2} more` : ""} →</p>
        </button>
      )}

      {onThisDay.length > 0 && (
        <button onClick={onOpenOnThisDay} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10, background: "#F1E3DC", border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", marginBottom: 16, cursor: "pointer" }}>
          <Calendar size={18} color="var(--accent-dark)" />
          <span style={{ fontSize: 12.5 }}><strong>On This Day</strong> — {onThisDay.length} memory to rediscover →</span>
        </button>
      )}

      <div className="label" style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Recent Chapters</div>
      {chapters.length === 0 ? (
        <EmptyState text="No chapters yet. Tap + to start writing your story." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {chapters.slice(0, 4).map((c) => <ChapterCard key={c.id} chapter={c} onOpen={() => onOpenChapter(c)} />)}
        </div>
      )}
      {chapters.length > 4 && <button onClick={onGoChapters} style={{ ...outlineBtn, marginTop: 10 }}>See all chapters →</button>}
    </div>
  );
}
const quickActionBtn = { display: "flex", alignItems: "center", gap: 8, padding: "12px 10px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 12, cursor: "pointer", color: "var(--text)" };

function EmptyState({ text }) {
  return (
    <div style={{ textAlign: "center", padding: "30px 20px", color: "var(--muted)", fontSize: 13 }}>
      <BookOpen size={26} color="var(--line)" style={{ marginBottom: 8 }} /><p>{text}</p>
    </div>
  );
}
function ChapterCard({ chapter, onOpen }) {
  const tag = tagInfo(chapter.tag);
  return (
    <div style={{ background: "var(--surface)", borderRadius: 14, overflow: "hidden", border: "1px solid var(--line)", cursor: "pointer" }} onClick={onOpen}>
      <div style={{ height: 80, background: chapter.photo ? `url(${chapter.photo}) center/cover` : "#F1E3DC" }} />
      <div style={{ padding: "8px 10px 10px" }}>
        <p style={{ fontSize: 12.5, fontWeight: 600, margin: "0 0 2px" }}>{chapter.title || "Untitled"}</p>
        <p style={{ fontSize: 10.5, color: "var(--muted)", margin: 0 }}>{tag.emoji} {fmtDate(chapter.date)}</p>
      </div>
    </div>
  );
}

/* ---------------- ON THIS DAY ---------------- */
function OnThisDayScreen({ chapters, onBack, onOpenChapter }) {
  const memories = computeOnThisDay(chapters).sort((a, b) => new Date(b.date) - new Date(a.date));
  const now = new Date();
  return (
    <div style={{ padding: "20px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer" }}><ChevronLeft size={22} /></button>
        <h2 className="display" style={{ fontSize: 18, margin: 0 }}>On This Day</h2>
      </div>
      {memories.length === 0 ? <EmptyState text="Nothing from today's date in past years — yet." /> : memories.map((c) => {
        const yearsAgo = now.getFullYear() - new Date(c.date).getFullYear();
        const tag = tagInfo(c.tag);
        return (
          <div key={c.id} onClick={() => onOpenChapter(c)} style={{ display: "flex", gap: 12, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 12, marginBottom: 10, cursor: "pointer" }}>
            <div style={{ width: 56, height: 56, borderRadius: 10, flexShrink: 0, background: c.photo ? `url(${c.photo}) center/cover` : "#F1E3DC" }} />
            <div>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 2px" }}>{yearsAgo} year{yearsAgo > 1 ? "s" : ""} ago</p>
              <p style={{ fontSize: 13.5, fontWeight: 600, margin: "0 0 2px" }}>{c.title}</p>
              <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>{tag.emoji} {tag.label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- REMINDERS MODAL ---------------- */
function RemindersModal({ profile, reminders, onAdd, onDelete, onClose }) {
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const annivDays = daysUntilAnnual(profile?.anniversary);
  const bdayDays = daysUntilAnnual(profile?.partnerBirthday);
  return (
    <ModalSheet onClose={onClose} title="Reminders">
      {bdayDays !== null && <div style={inlineBox}>🎂 {cap(refer(profile, "possessive"))} Birthday — in {bdayDays} days</div>}
      {annivDays !== null && <div style={inlineBox}>💍 Anniversary — in {annivDays} days</div>}
      {reminders.map((r) => (
        <div key={r.id} style={{ ...inlineBox, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>🔔 {r.label} — in {daysUntilAnnual(r.date)} days</span>
          <button onClick={() => onDelete(r.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={14} color="var(--muted)" /></button>
        </div>
      ))}
      <div className="label" style={{ fontSize: 10.5, color: "var(--muted)", margin: "12px 0 6px" }}>Add a custom reminder</div>
      <input style={inputStyle} placeholder="e.g. Her mom's birthday" value={label} onChange={(e) => setLabel(e.target.value)} />
      <input style={inputStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <button style={primaryBtn} onClick={() => { if (label && date) { onAdd(label, date); setLabel(""); setDate(""); } }}>Add reminder</button>
    </ModalSheet>
  );
}
const inlineBox = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", marginBottom: 8, fontSize: 12.5 };

/* ---------------- MOOD LOG MODAL ---------------- */
function MoodLogModal({ onClose, onSave }) {
  const [mood, setMood] = useState(null);
  const [note, setNote] = useState("");
  return (
    <ModalSheet onClose={onClose} title="Log their mood">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        {MOODS.map((m) => (
          <button key={m.id} onClick={() => setMood(m.id)} style={{
            padding: "12px 6px", borderRadius: 12, textAlign: "center", cursor: "pointer",
            border: mood === m.id ? "1px solid var(--accent)" : "1px solid var(--line)",
            background: mood === m.id ? "#FBEAEE" : "var(--surface)", fontSize: 11,
          }}>
            <div style={{ fontSize: 20 }}>{m.emoji}</div>{m.label}
          </button>
        ))}
      </div>
      <textarea style={{ ...inputStyle, minHeight: 60, resize: "none" }} placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
      <button style={{ ...primaryBtn, opacity: mood ? 1 : 0.5 }} disabled={!mood} onClick={() => onSave(mood, note.trim())}>Save mood</button>
    </ModalSheet>
  );
}

/* ---------------- NOTES MODAL ---------------- */
function NotesModal({ notes, onAdd, onDelete, onClose }) {
  const [text, setText] = useState("");
  return (
    <ModalSheet onClose={onClose} title="Important Notes">
      {notes.length === 0 && <p style={{ fontSize: 12, color: "var(--muted)" }}>No notes yet — allergies, preferences, things worth remembering.</p>}
      {notes.map((n) => (
        <div key={n.id} style={{ ...inlineBox, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{n.text}</span>
          <button onClick={() => onDelete(n.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={14} color="var(--muted)" /></button>
        </div>
      ))}
      <div style={{ marginTop: 10 }}>
        <input style={inputStyle} placeholder="e.g. Allergic to peanuts" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && (onAdd(text.trim()), setText(""))} />
        <button style={primaryBtn} onClick={() => { if (text.trim()) { onAdd(text.trim()); setText(""); } }}>Add note</button>
      </div>
    </ModalSheet>
  );
}

/* ---------------- Generic bottom-sheet modal ---------------- */
function ModalSheet({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(51,38,43,0.4)", zIndex: 35, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 480, background: "var(--surface)", borderRadius: "20px 20px 0 0", maxHeight: "88vh", overflowY: "auto", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 className="display" style={{ fontSize: 16, margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   CHAPTER DETAIL
----------------------------------------------------------------*/
function ChapterDetail({ chapter, onClose, onToggleFavorite, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tag = tagInfo(chapter.tag);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(51,38,43,0.4)", zIndex: 30, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 480, background: "var(--surface)", borderRadius: "20px 20px 0 0", maxHeight: "92vh", overflowY: "auto", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><ChevronLeft size={22} /></button>
          <div style={{ display: "flex", gap: 14 }}>
            <button onClick={() => onToggleFavorite(chapter.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Heart size={20} fill={chapter.favorite ? "var(--accent)" : "none"} color="var(--accent)" /></button>
            <button onClick={() => setConfirmDelete(true)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={20} color="var(--muted)" /></button>
          </div>
        </div>
        {chapter.photo && <div style={{ height: 200, borderRadius: 14, background: `url(${chapter.photo}) center/cover`, marginBottom: 14 }} />}
        <h2 className="display" style={{ fontSize: 20, margin: "0 0 4px" }}>{chapter.title}</h2>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>{fmtDate(chapter.date)} · {tag.emoji} {tag.label}</p>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text)", whiteSpace: "pre-wrap", marginBottom: 18 }}>{chapter.story}</p>
        {chapter.voiceNote && (
          <div style={{ marginBottom: 10 }}>
            <p style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Voice note</p>
            <audio controls src={chapter.voiceNote} style={{ width: "100%" }} />
          </div>
        )}
        {confirmDelete && (
          <div style={{ background: "#FBEAE8", border: "1px solid #E9BDB8", borderRadius: 12, padding: 14, marginTop: 10 }}>
            <p style={{ fontSize: 12.5, marginBottom: 10 }}>Delete this chapter? This can't be undone.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...outlineBtn, flex: 1 }} onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button style={{ ...primaryBtn, flex: 1, background: "var(--accent-dark)" }} onClick={() => onDelete(chapter.id)}>Delete</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   ADD CHAPTER
----------------------------------------------------------------*/
function compressImage(file, maxWidth = 800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale; canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.onerror = reject; img.src = e.target.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}
function AddChapter({ onClose, onSave }) {
  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
  const [date, setDate] = useState(todayISO());
  const [tag, setTag] = useState("daily-life");
  const [photo, setPhoto] = useState(null);
  const [voiceNote, setVoiceNote] = useState(null);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => setVoiceNote(reader.result);
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start(); mediaRecorderRef.current = mr; setRecording(true);
    } catch (e) { alert("Couldn't access the microphone. Check your browser permissions."); }
  }
  function stopRecording() { mediaRecorderRef.current?.stop(); setRecording(false); }
  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(await compressImage(file));
  }
  async function handleSave() {
    if (!title.trim() && !story.trim()) { alert("Add at least a title or a bit of your story."); return; }
    setSaving(true);
    await onSave({ title: title.trim() || "Untitled moment", story: story.trim(), date, tag, photo, voiceNote });
    setSaving(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(51,38,43,0.4)", zIndex: 30, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 480, background: "var(--surface)", borderRadius: "20px 20px 0 0", maxHeight: "92vh", overflowY: "auto", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={22} /></button>
          <h3 className="display" style={{ fontSize: 16, margin: 0 }}>Create a Chapter</h3>
          <button onClick={handleSave} disabled={saving} style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 600, fontSize: 13.5, cursor: "pointer", opacity: saving ? 0.5 : 1 }}>{saving ? "Saving…" : "Save"}</button>
        </div>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: photo ? 140 : 64, borderRadius: 12, border: "1px dashed var(--line)", marginBottom: 12, cursor: "pointer", overflow: "hidden", background: photo ? `url(${photo}) center/cover` : "#FDFAF8", color: "var(--muted)", fontSize: 12.5 }}>
          {!photo && <><Camera size={16} /> Add Photo (optional)</>}
          <input type="file" accept="image/*" onChange={handlePhoto} style={{ display: "none" }} />
        </label>
        <input style={inputStyle} placeholder="Title of this moment" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea style={{ ...inputStyle, minHeight: 90, resize: "none" }} placeholder="Write your story... What happened? How did you feel?" value={story} onChange={(e) => setStory(e.target.value)} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {TAGS.map((t) => (
            <button key={t.id} onClick={() => setTag(t.id)} style={{ padding: "6px 11px", borderRadius: 999, fontSize: 11.5, cursor: "pointer", border: tag === t.id ? "1px solid var(--accent)" : "1px solid var(--line)", background: tag === t.id ? "var(--accent)" : "transparent", color: tag === t.id ? "#fff" : "var(--text)" }}>{t.emoji} {t.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ border: "none", background: "none", fontSize: 12.5 }} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Voice note (optional)</p>
          {voiceNote ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <audio controls src={voiceNote} style={{ flex: 1 }} />
              <button onClick={() => setVoiceNote(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={16} color="var(--muted)" /></button>
            </div>
          ) : (
            <button onClick={recording ? stopRecording : startRecording} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 12, border: "1px solid var(--line)", background: recording ? "#FBEAE8" : "transparent", cursor: "pointer", fontSize: 12.5 }}>
              {recording ? <Square size={14} color="var(--accent-dark)" /> : <Mic size={14} />}{recording ? "Stop recording" : "Record a voice note"}
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--muted)", opacity: 0.7 }}><Video size={14} /> Video attachments — coming soon</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   CHAPTERS + SEARCH (merged tab)
----------------------------------------------------------------*/
function ChaptersScreen({ chapters, onOpenChapter, onToggleFavorite }) {
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const q = query.trim().toLowerCase();
  let list = chapters;
  if (q) list = list.filter((c) => (c.title + " " + c.story).toLowerCase().includes(q));
  else if (filter !== "all") list = filter === "favorites" ? list.filter((c) => c.favorite) : list.filter((c) => c.tag === filter);

  return (
    <div style={{ padding: "20px 18px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h1 className="display" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Chapters</h1>
        <button onClick={() => setShowSearch((s) => !s)} style={{ background: "none", border: "none", cursor: "pointer" }}><SearchIcon size={19} color="var(--text)" /></button>
      </div>
      {showSearch && (
        <input autoFocus style={inputStyle} placeholder="Search your story..." value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      {!q && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 14 }}>
          {[{ id: "all", label: "All" }, { id: "favorites", label: "Favorites" }, ...TAGS].map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 999, fontSize: 11.5, cursor: "pointer", border: filter === f.id ? "1px solid var(--accent)" : "1px solid var(--line)", background: filter === f.id ? "var(--accent)" : "var(--surface)", color: filter === f.id ? "#fff" : "var(--text)" }}>
              {f.emoji ? `${f.emoji} ` : ""}{f.label}
            </button>
          ))}
        </div>
      )}
      {list.length === 0 ? <EmptyState text="No chapters here yet." /> : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {list.map((c) => (
            <div key={c.id} style={{ position: "relative" }}>
              <ChapterCard chapter={c} onOpen={() => onOpenChapter(c)} />
              <button onClick={(e) => { e.stopPropagation(); onToggleFavorite(c.id); }} style={{ position: "absolute", top: 6, right: 6, background: "rgba(255,255,255,0.85)", border: "none", borderRadius: 999, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Heart size={12} fill={c.favorite ? "var(--accent)" : "none"} color="var(--accent)" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   TO-DO (subtabs: To-Do / Promises / Bucket List)
----------------------------------------------------------------*/
function TodoScreen(props) {
  const [subtab, setSubtab] = useState("todo");
  return (
    <div style={{ padding: "20px 18px 8px" }}>
      <h1 className="display" style={{ fontSize: 20, fontWeight: 600, margin: "0 0 14px" }}>To-Do</h1>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {[{ id: "todo", label: "To-Do" }, { id: "promises", label: "Promises" }, { id: "bucket", label: "Bucket List" }].map((s) => (
          <button key={s.id} onClick={() => setSubtab(s.id)} style={{ flex: 1, padding: "8px 4px", fontSize: 11.5, cursor: "pointer", border: "1px solid var(--line)", background: subtab === s.id ? "var(--text)" : "var(--surface)", color: subtab === s.id ? "#fff" : "var(--text)", borderRadius: 10 }}>{s.label}</button>
        ))}
      </div>
      {subtab === "todo" && <TodoList {...props} />}
      {subtab === "promises" && <PromiseList {...props} />}
      {subtab === "bucket" && <BucketList {...props} />}
    </div>
  );
}
function TodoList({ todos, onAddTodo, onToggleTodo, onDeleteTodo }) {
  const [text, setText] = useState("");
  const [period, setPeriod] = useState("weekly");
  const [scope, setScope] = useState("all");
  const filtered = scope === "all" ? todos : todos.filter((t) => t.period === scope);
  return (
    <>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {["all", "weekly", "monthly", "once"].map((s) => (
          <button key={s} onClick={() => setScope(s)} style={{ padding: "5px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer", border: scope === s ? "1px solid var(--accent)" : "1px solid var(--line)", background: scope === s ? "var(--accent)" : "var(--surface)", color: scope === s ? "#fff" : "var(--text)" }}>{cap(s)}</button>
        ))}
      </div>
      {filtered.length === 0 ? <EmptyState text="No to-dos here yet." /> : filtered.map((t) => (
        <div key={t.id} style={{ ...inlineBox, display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => onToggleTodo(t.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><CheckSquare size={18} color={t.done ? "var(--accent)" : "var(--muted)"} /></button>
          <span style={{ flex: 1, textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--muted)" : "var(--text)" }}>{t.text} <span style={{ color: "var(--muted)", fontSize: 10.5 }}>· {cap(t.period)}</span></span>
          <button onClick={() => onDeleteTodo(t.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={14} color="var(--muted)" /></button>
        </div>
      ))}
      <div style={{ marginTop: 12 }}>
        <input style={inputStyle} placeholder="New to-do" value={text} onChange={(e) => setText(e.target.value)} />
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {["weekly", "monthly", "once"].map((p) => (
            <button key={p} onClick={() => setPeriod(p)} style={{ flex: 1, padding: "7px", borderRadius: 8, fontSize: 11, cursor: "pointer", border: period === p ? "1px solid var(--accent)" : "1px solid var(--line)", background: period === p ? "var(--accent)" : "var(--surface)", color: period === p ? "#fff" : "var(--text)" }}>{cap(p)}</button>
          ))}
        </div>
        <button style={primaryBtn} onClick={() => { if (text.trim()) { onAddTodo(text.trim(), period); setText(""); } }}>Add to-do</button>
      </div>
    </>
  );
}
function PromiseList({ promises, onAddPromise, onMarkPromise, onDeletePromise }) {
  const [text, setText] = useState("");
  return (
    <>
      {promises.length === 0 ? <EmptyState text="No promises tracked yet." /> : promises.map((p) => (
        <div key={p.id} style={inlineBox}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>{p.text}</span>
            <button onClick={() => onDeletePromise(p.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={14} color="var(--muted)" /></button>
          </div>
          <p style={{ fontSize: 10.5, color: "var(--muted)", margin: "0 0 6px" }}>Kept {p.keptCount} · Broken {p.brokenCount}</p>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => onMarkPromise(p.id, "kept")} style={{ flex: 1, padding: "6px", borderRadius: 8, border: "1px solid var(--accent)", background: "transparent", color: "var(--accent)", fontSize: 11, cursor: "pointer" }}>Mark Kept</button>
            <button onClick={() => onMarkPromise(p.id, "broken")} style={{ flex: 1, padding: "6px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>Mark Broken</button>
          </div>
        </div>
      ))}
      <div style={{ marginTop: 12 }}>
        <input style={inputStyle} placeholder='e.g. "Will cook dinner every Friday"' value={text} onChange={(e) => setText(e.target.value)} />
        <button style={primaryBtn} onClick={() => { if (text.trim()) { onAddPromise(text.trim()); setText(""); } }}>Add a promise</button>
      </div>
    </>
  );
}
function BucketList({ bucketlist, onAddBucketItem, onToggleBucketItem, onDeleteBucketItem }) {
  const [text, setText] = useState("");
  return (
    <>
      {bucketlist.length === 0 ? <EmptyState text="No bucket-list items yet." /> : bucketlist.map((b) => (
        <div key={b.id} style={{ ...inlineBox, display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => onToggleBucketItem(b.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><CheckSquare size={18} color={b.done ? "var(--accent)" : "var(--muted)"} /></button>
          <span style={{ flex: 1, textDecoration: b.done ? "line-through" : "none", color: b.done ? "var(--muted)" : "var(--text)" }}>{b.text}</span>
          <button onClick={() => onDeleteBucketItem(b.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={14} color="var(--muted)" /></button>
        </div>
      ))}
      <div style={{ marginTop: 12 }}>
        <input style={inputStyle} placeholder="e.g. Visit Ladakh together" value={text} onChange={(e) => setText(e.target.value)} />
        <button style={primaryBtn} onClick={() => { if (text.trim()) { onAddBucketItem(text.trim()); setText(""); } }}>Add to bucket list</button>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------
   PROFILE / SETTINGS
----------------------------------------------------------------*/
function ProfileScreen({ profile, chapterCount, mode, onLock, onLogOut, onExport, onImport, onOpenPartnerProfile, onOpenScoreDetail, onMigrateToAccount, onDeleteAccount }) {
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [showMigrate, setShowMigrate] = useState(false);
  const fileInputRef = useRef(null);

  const row = (label, right, onClick) => (
    <div onClick={onClick} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 4px", borderBottom: "1px solid var(--line)", fontSize: 13.5, cursor: onClick ? "pointer" : "default" }}>
      <span>{label}</span>{right && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{right}</span>}
    </div>
  );

  async function handleImportFile(e) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    const confirmed = window.confirm("Importing will replace everything currently stored in this app with the contents of the backup file. This can't be undone. Continue?");
    if (!confirmed) return;
    setImportBusy(true); setImportMsg("");
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed.meta) throw new Error("not a Daampatyam backup file");
      await onImport(parsed);
      setImportMsg("Imported. Enter the backup's passphrase to unlock it.");
    } catch (e2) { setImportMsg("That file couldn't be read as a Daampatyam backup."); }
    setImportBusy(false);
  }

  return (
    <div style={{ padding: "24px 18px" }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ width: 60, height: 60, borderRadius: 999, background: "#F1E3DC", margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center" }}><Heart size={22} color="var(--accent)" /></div>
        <h2 className="display" style={{ fontSize: 17, margin: "0 0 3px" }}>{profile?.name} & {profile?.partnerName}</h2>
        {profile?.anniversary && <p style={{ fontSize: 11.5, color: "var(--muted)", margin: 0 }}>Together since {fmtDate(profile.anniversary)}</p>}
      </div>

      {row("Chapters written", String(chapterCount))}
      {row("Partner Profile", "→", onOpenPartnerProfile)}
      {row("Relationship Score", "→", onOpenScoreDetail)}
      {row("Encryption", "AES-256, end-to-end")}
      {row("Account", mode === "account" ? "Synced" : "Guest (this device only)")}

      {mode === "guest" && (
        <div style={{ marginTop: 16 }}>
          <button onClick={() => setShowMigrate(true)} style={{ ...outlineBtn, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Users size={14} /> Create an account & sync</button>
        </div>
      )}

      <p style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, margin: "22px 0 8px" }}>Backup</p>
      <button onClick={onExport} style={{ ...outlineBtn, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}><Download size={14} /> Export my story</button>
      <button onClick={() => fileInputRef.current?.click()} disabled={importBusy} style={{ ...outlineBtn, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: importBusy ? 0.6 : 1 }}><Upload size={14} /> {importBusy ? "Importing…" : "Import from backup"}</button>
      <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportFile} style={{ display: "none" }} />
      {importMsg && <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>{importMsg}</p>}

      <button onClick={onLock} style={{ ...outlineBtn, marginTop: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Lock size={14} /> Lock my story</button>
      {mode === "account" && (
        <button onClick={onLogOut} style={{ ...outlineBtn, marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><LogOut size={14} /> Log out</button>
      )}
      {mode === "account" && (
        <button
          onClick={() => {
            if (window.confirm("This permanently deletes your account and everything in it. This cannot be undone. Continue?")) {
              if (window.confirm("Are you absolutely sure? Type nothing needed — just confirm once more.")) {
                onDeleteAccount();
              }
            }
          }}
          style={{ ...outlineBtn, marginTop: 8, borderColor: "var(--accent-dark)", color: "var(--accent-dark)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        >
          <Trash2 size={14} /> Delete my account
        </button>
      )}

      {showMigrate && (
        <MigrateModal onClose={() => setShowMigrate(false)} onMigrated={() => { setShowMigrate(false); onMigrateToAccount(); }} />
      )}
    </div>
  );
}

function MigrateModal({ onClose, onMigrated }) {
  const [mode, setMode] = useState("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!supabase) { setError("Backend isn't configured yet."); return; }
    setBusy(true); setError(""); setInfo("");
    try {
      let session;
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        session = data.session;
        if (!session) { setInfo("Check your email to confirm, then come back and log in here."); setMode("login"); setBusy(false); return; }
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        session = data.session;
      }
      const confirmed = window.confirm("Bring your current local data into this account?");
      if (confirmed) await onMigrated();
      else onClose();
    } catch (e) { setError(e.message || "Something went wrong."); }
    setBusy(false);
  }

  return (
    <ModalSheet title="Create an account & sync" onClose={onClose}>
      <input style={inputStyle} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input style={inputStyle} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p style={{ color: "var(--accent-dark)", fontSize: 12.5, marginBottom: 10 }}>{error}</p>}
      {info && <p style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 10 }}>{info}</p>}
      <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={handleSubmit}>{busy ? "Please wait…" : mode === "signup" ? "Create Account →" : "Log In →"}</button>
      <button style={{ ...outlineBtn, marginTop: 10 }} onClick={() => setMode(mode === "signup" ? "login" : "signup")}>{mode === "signup" ? "Already have an account? Log in" : "New here? Create an account"}</button>
    </ModalSheet>
  );
}

/* ---------------------------------------------------------------
   PARTNER PROFILE (full detail screen)
----------------------------------------------------------------*/
function PartnerProfileScreen({ profile, onBack, onSave }) {
  const [nickname, setNickname] = useState(profile?.nickname || "");
  const [partnerBirthday, setPartnerBirthday] = useState(profile?.partnerBirthday || "");
  const [gender, setGender] = useState(profile?.gender || "");
  const [loveLanguage, setLoveLanguage] = useState(profile?.loveLanguage || "");
  const [favorites, setFavorites] = useState(profile?.favorites || "");
  const [wishlist, setWishlist] = useState(profile?.wishlist || "");
  const [complaints, setComplaints] = useState(profile?.complaints || "");

  const genderOptions = [
    { id: "she", label: "She / Her" }, { id: "he", label: "He / Him" },
    { id: "they", label: "They / Them" }, { id: "name", label: "Just their name" },
  ];
  const loveLanguages = ["Words of Affirmation", "Quality Time", "Acts of Service", "Gifts", "Physical Touch"];

  return (
    <div style={{ padding: "20px 18px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer" }}><ChevronLeft size={22} /></button>
        <h2 className="display" style={{ fontSize: 17, margin: 0 }}>Partner Profile</h2>
      </div>
      <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Nickname</label>
      <input style={inputStyle} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. Mou" />
      <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Their birthday</label>
      <input style={inputStyle} type="date" value={partnerBirthday} onChange={(e) => setPartnerBirthday(e.target.value)} />
      <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Pronouns</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0 12px" }}>
        {genderOptions.map((g) => (
          <button key={g.id} onClick={() => setGender(g.id)} style={{ padding: "7px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer", border: gender === g.id ? "1px solid var(--accent)" : "1px solid var(--line)", background: gender === g.id ? "var(--accent)" : "transparent", color: gender === g.id ? "#fff" : "var(--text)" }}>{g.label}</button>
        ))}
      </div>
      <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Love language</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0 12px" }}>
        {loveLanguages.map((l) => (
          <button key={l} onClick={() => setLoveLanguage(l)} style={{ padding: "7px 12px", borderRadius: 999, fontSize: 11.5, cursor: "pointer", border: loveLanguage === l ? "1px solid var(--accent)" : "1px solid var(--line)", background: loveLanguage === l ? "var(--accent)" : "transparent", color: loveLanguage === l ? "#fff" : "var(--text)" }}>{l}</button>
        ))}
      </div>
      <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Favorites (food, color, flower...)</label>
      <textarea style={{ ...inputStyle, minHeight: 60, resize: "none" }} value={favorites} onChange={(e) => setFavorites(e.target.value)} placeholder="Biryani, teal, jasmine..." />
      <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Wishlist</label>
      <textarea style={{ ...inputStyle, minHeight: 60, resize: "none" }} value={wishlist} onChange={(e) => setWishlist(e.target.value)} placeholder="A pottery class, a weekend in Coorg..." />
      <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Pet peeves / complaints</label>
      <textarea style={{ ...inputStyle, minHeight: 60, resize: "none" }} value={complaints} onChange={(e) => setComplaints(e.target.value)} placeholder="Doesn't like being interrupted..." />
      <button style={primaryBtn} onClick={() => onSave({ nickname, partnerBirthday, gender, loveLanguage, favorites, wishlist, complaints })}>Save →</button>
    </div>
  );
}

/* ---------------------------------------------------------------
   SCORE DETAIL
----------------------------------------------------------------*/
function ScoreDetailScreen({ score, onBack }) {
  return (
    <div style={{ padding: "20px 18px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer" }}><ChevronLeft size={22} /></button>
        <h2 className="display" style={{ fontSize: 17, margin: 0 }}>Relationship Score</h2>
      </div>
      <div style={{ background: "var(--text)", color: "#fff", borderRadius: 14, padding: "16px", textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 26, fontWeight: 700 }}>{score.total}</div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>{scoreTier(score.total)}</div>
      </div>
      {score.breakdown.map((b, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 4px", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
          <span>{b.label} ({b.count})</span>
          <span style={{ color: b.pts < 0 ? "var(--accent-dark)" : "var(--text)" }}>{b.pts >= 0 ? "+" : ""}{b.pts}</span>
        </div>
      ))}
      <p style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 14, lineHeight: 1.5 }}>Point values are placeholders for now — happy to tune the weights once you've used it for a bit.</p>
    </div>
  );
}

/* ---------------------------------------------------------------
   FEEDBACK PROMPT
----------------------------------------------------------------*/
function FeedbackPrompt({ onSubmit, onDismiss }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(51,38,43,0.4)", zIndex: 40, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 480, background: "var(--surface)", borderRadius: "20px 20px 0 0", padding: 24 }}>
        <h3 className="display" style={{ fontSize: 17, margin: "0 0 6px" }}>How's it feeling so far?</h3>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 16px", lineHeight: 1.5 }}>This is an early prototype — a quick reaction helps shape where Daampatyam goes next.</p>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setRating(n)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }} aria-label={`Rate ${n} stars`}>
              <Star size={26} fill={n <= rating ? "var(--gold)" : "none"} color="var(--gold)" />
            </button>
          ))}
        </div>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything you loved, or found confusing? (optional)" style={{ ...inputStyle, minHeight: 70, resize: "none" }} />
        <button style={{ ...primaryBtn, opacity: rating ? 1 : 0.5 }} disabled={!rating} onClick={() => onSubmit(rating, comment.trim())}>Submit feedback</button>
        <button style={{ ...outlineBtn, marginTop: 10 }} onClick={onDismiss}>Maybe later</button>
      </div>
    </div>
  );
}
