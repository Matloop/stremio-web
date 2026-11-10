// LingoBlend ↔ Linguarudo: the word bank behind the token pasted in the menu.
// API (Linguarudo /api, Authorization: Bearer):
//   GET  /api/me                     → { email }
//   GET  /api/words?lang=it          → { words: [{ term, translation, state, dueAt, paused, prefer }] }
//   POST /api/words { words }        → { results: [{ term, lang, status: created|duplicate|invalid, state, dueAt }] }
//   POST /api/words/seen { lang, terms } → { updated }

// Production Linguarudo. Self-host / dev: change it in the menu (e.g. http://localhost:5173).
const DEFAULT_LINGUARUDO_URL = 'https://linguarudo-app.vercel.app';

const QUEUE_KEY = 'lingoblend.linguarudoQueue';
const SAVE_BATCH = 200;
const BANK_LANGS = ['en', 'it'];

const apiBaseUrl = (url) => {
    const value = typeof url === 'string' ? url.trim().replace(/\/+$/, '') : '';
    return value.length > 0 ? value : DEFAULT_LINGUARUDO_URL;
};

const createLinguarudoApi = ({ fetchImpl = (...args) => fetch(...args) } = {}) => {
    const request = async ({ url, token }, method, path, body, extra = {}) => {
        const headers = { Authorization: `Bearer ${token}` };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let response;
        try {
            response = await fetchImpl(`${apiBaseUrl(url)}/api${path}`, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                ...extra,
            });
        } catch (cause) {
            throw Object.assign(new Error('Linguarudo fora do ar'), { offline: true, cause });
        }
        let data = null;
        try {
            data = await response.json();
        } catch (_error) {
            // not JSON
        }
        if (!response.ok) {
            const message = data && typeof data.message === 'string' && data.message.length > 0 ? data.message : `Linguarudo respondeu ${response.status}`;
            throw Object.assign(new Error(message), { status: response.status });
        }
        return data;
    };

    return {
        me: (conn) => request(conn, 'GET', '/me'),
        listWords: (conn, lang) => request(conn, 'GET', `/words?lang=${encodeURIComponent(lang)}`),
        saveWords: (conn, words) => request(conn, 'POST', '/words', { words }),
        // keepalive: also used when the player closes.
        markSeen: (conn, lang, terms, extra) => request(conn, 'POST', '/words/seen', { lang, terms }, extra),
    };
};

const str = (value) => (typeof value === 'string' ? value : '');

// Card click → word for the bank. The term is the lemma ("festa"); the form seen on screen ("feste")
// stays in the context (the mixed line) and in contextHighlight, so Revisar can highlight it.
const toApiWord = ({ annotation, targetLang, displayText, cueText, shownText, title, timeMs, savedAt }) => {
    const target = str(annotation.target);
    const time = Number.isFinite(timeMs) && timeMs >= 0 ? Math.floor(timeMs / 1000) : null;
    return {
        term: str(annotation.lemma) || target,
        lang: targetLang,
        translation: str(annotation.meaning) || str(annotation.source),
        context: str(displayText) || str(cueText),
        contextHighlight: str(shownText) || target,
        ipa: str(annotation.ipa),
        pos: str(annotation.pos),
        meaning: str(annotation.meaning),
        example: str(annotation.example),
        sourceTitle: str(title),
        sourceTimeS: time,
        savedAt,
    };
};

// Old local format (lingoblend.savedWords, before the bank): no lemma, cueText is the original line.
const fromSavedWord = (saved) => {
    if (!saved || !BANK_LANGS.includes(saved.targetLang) || str(saved.target).length === 0) return null;
    return {
        term: saved.target,
        lang: saved.targetLang,
        translation: str(saved.meaning) || str(saved.source),
        context: str(saved.cueText),
        contextHighlight: '',
        meaning: str(saved.meaning),
        example: str(saved.example),
        sourceTitle: str(saved.title),
        savedAt: str(saved.savedAt) || undefined,
    };
};

const wordKey = (lang, term) => `${lang}\u0000${String(term).toLowerCase()}`;

// Saves that did not reach the server wait here (localStorage) and are retried.
const createSaveQueue = ({ storage, key = QUEUE_KEY }) => {
    const read = () => {
        try {
            const value = JSON.parse(storage.getItem(key));
            return Array.isArray(value) ? value.filter((w) => w && typeof w === 'object') : [];
        } catch (_error) {
            return [];
        }
    };
    const write = (items) => {
        try {
            if (items.length > 0) storage.setItem(key, JSON.stringify(items));
            else storage.removeItem(key);
        } catch (error) {
            console.warn('LingoBlend: unable to persist the Linguarudo queue', error);
        }
    };
    return {
        items: read,
        add: (words) => {
            const items = read();
            const keys = new Set(items.map((w) => wordKey(w.lang, w.term)));
            for (const word of words) {
                const k = wordKey(word.lang, word.term);
                if (!keys.has(k)) {
                    keys.add(k);
                    items.push(word);
                }
            }
            write(items);
        },
        remove: (words) => {
            const done = new Set(words);
            write(read().filter((w) => !done.has(JSON.stringify(w))));
        },
    };
};

// Sends the queue in batches. Answered items (created / duplicate / invalid) leave the queue;
// a network error or a non-OK answer stops and keeps the rest for the next try.
const flushQueue = async ({ queue, api, conn }) => {
    const all = [];
    for (;;) {
        const batch = queue.items().slice(0, SAVE_BATCH);
        if (batch.length === 0) return all;
        const { results } = await api.saveWords(conn, batch);
        queue.remove(batch.map((w) => JSON.stringify(w)));
        all.push(...(Array.isArray(results) ? results : []));
    }
};

const indexBank = (words) => {
    const bank = new Map();
    for (const word of Array.isArray(words) ? words : []) {
        if (word && typeof word.term === 'string') bank.set(word.term.toLowerCase(), word);
    }
    return bank;
};

const preferWordsOf = (words) => (Array.isArray(words) ? words : []).filter((w) => w && w.prefer).map((w) => w.term.toLowerCase());

// "Visto": bank words that showed up in a subtitle. stremio-video emits 'shown' on every render of a
// cue, so each (request, cue, lemma) counts once.
const createSeenTracker = () => {
    const noted = new Set();
    let pending = new Set();
    return {
        note: ({ requestId, cueId, annotations }, bank) => {
            for (const annotation of Array.isArray(annotations) ? annotations : []) {
                const term = (str(annotation.lemma) || str(annotation.target)).toLowerCase();
                if (!term || !bank.has(term)) continue;
                const k = `${requestId}\u0000${cueId}\u0000${term}`;
                if (noted.has(k)) continue;
                noted.add(k);
                pending.add(term);
            }
        },
        take: () => {
            const terms = [...pending];
            pending = new Set();
            return terms;
        },
    };
};

const pad = (n) => String(n).padStart(2, '0');

// "agora", "hoje às 18:05", "amanhã às 09:00", "em 5 dias" (local time of the player).
const formatNextReview = (dueAt, now = new Date()) => {
    const at = new Date(dueAt);
    if (Number.isNaN(at.getTime())) return '';
    if (at.getTime() <= now.getTime()) return 'agora';
    const days = Math.round((Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    if (days === 0) return `hoje às ${time}`;
    if (days === 1) return `amanhã às ${time}`;
    return `em ${days} dias`;
};

module.exports = {
    DEFAULT_LINGUARUDO_URL,
    BANK_LANGS,
    apiBaseUrl,
    createLinguarudoApi,
    toApiWord,
    fromSavedWord,
    createSaveQueue,
    flushQueue,
    createSeenTracker,
    indexBank,
    preferWordsOf,
    formatNextReview,
};
