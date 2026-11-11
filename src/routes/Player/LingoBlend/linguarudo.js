// LingoBlend ↔ Linguarudo: the word bank behind the token pasted in the menu.
// API v1 (Linguarudo /api/v1, Authorization: Bearer; contract in linguarudo/packages/stremio-server/docs/CONTRACT.md §5):
//   GET  /api/v1/me                              → { email, nativeLanguage, studyLanguages }
//   GET  /api/v1/items?language=it               → { language, items: [ApiItem], preferWords: [lemma] }
//   POST /api/v1/items { items: [SaveItem] }     → { results: [{ ok: true, item } | { ok: false, error }] }
//   POST /api/v1/items/seen { language, lemmas } → { updated }

// Production Linguarudo. Self-host / dev: change it in the menu (e.g. http://localhost:5173).
const DEFAULT_LINGUARUDO_URL = 'https://linguarudo-app.vercel.app';

const QUEUE_KEY = 'lingoblend.linguarudoQueue';
const SAVE_BATCH = 200;

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
            response = await fetchImpl(`${apiBaseUrl(url)}/api/v1${path}`, {
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
        listItems: (conn, language) => request(conn, 'GET', `/items?language=${encodeURIComponent(language)}`),
        saveItems: (conn, items) => request(conn, 'POST', '/items', { items }),
        // keepalive: also used when the player closes.
        markSeen: (conn, language, lemmas, extra) => request(conn, 'POST', '/items/seen', { language, lemmas }, extra),
    };
};

const str = (value) => (typeof value === 'string' ? value : '');

// Idempotency key of an encounter: a retried save does not create a second one.
const newClientId = () => {
    const { crypto } = globalThis;
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // randomUUID only exists in secure contexts.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// The episode or film being watched, from the player's metaItem (stremio-core) and seriesInfo.
const toApiWork = ({ metaItem, seriesInfo, title }) => {
    const name = str(metaItem && metaItem.name) || str(title);
    if (name.length === 0) return null;
    const episode = seriesInfo && Number.isInteger(seriesInfo.season) && Number.isInteger(seriesInfo.episode) ? seriesInfo : null;
    const id = str(metaItem && metaItem.id);
    const refs = {};
    if (/^tt\d+$/.test(id)) {
        refs.imdbId = id;
        if (episode !== null) {
            refs.season = episode.season;
            refs.episode = episode.episode;
        }
    }
    const kind = metaItem && metaItem.type === 'movie' ? 'filme' : episode !== null ? 'episodio' : 'video';
    return {
        kind,
        title: name,
        subtitle: kind === 'episodio' ? `T${episode.season}E${episode.episode}` : '',
        refs,
    };
};

// Card click → item for the bank. The lemma is the dictionary form ("festa"); the form seen on screen
// ("feste") goes to the encounter, with the mixed line, so Revisar can highlight it.
const toApiItem = ({ annotation, targetLang, displayText, cueText, shownText, timeMs, seenAt, clientId, work }) => {
    const target = str(annotation.target);
    const form = str(shownText) || target;
    const item = {
        language: targetLang,
        lemma: str(annotation.lemma) || target,
        sense: str(annotation.meaning) || str(annotation.source),
        ipa: str(annotation.ipa),
        partOfSpeech: str(annotation.pos),
        encounter: {
            form,
            sentence: str(displayText) || str(cueText),
            highlight: form,
            sense: str(annotation.source),
            position: Number.isFinite(timeMs) && timeMs >= 0 ? { seconds: Math.floor(timeMs / 1000) } : {},
            seenAt,
            clientId,
            origin: 'stremio',
        },
    };
    if (work) item.work = work;
    return item;
};

// Old local format (lingoblend.savedWords, before the bank): no lemma (the lemma is the form seen),
// cueText is the original line, so there is nothing to highlight in it.
const fromSavedWord = (saved, clientId) => {
    if (!saved || str(saved.targetLang).length === 0 || str(saved.target).length === 0) return null;
    const item = {
        language: saved.targetLang,
        lemma: saved.target,
        sense: str(saved.meaning) || str(saved.source),
        encounter: {
            form: saved.target,
            sentence: str(saved.cueText),
            highlight: '',
            sense: str(saved.source),
            seenAt: str(saved.savedAt) || null,
            clientId,
            origin: 'stremio',
        },
    };
    if (str(saved.title).length > 0) item.work = { kind: 'video', title: saved.title };
    return item;
};

// One entry per encounter (clientId); an item without encounter is unique by language + lemma.
const queueKey = (item) => {
    const clientId = item.encounter && str(item.encounter.clientId);
    return clientId ? `c\u0000${clientId}` : `l\u0000${item.language}\u0000${String(item.lemma).toLowerCase()}`;
};

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
        add: (entries) => {
            const items = read();
            const keys = new Set(items.map(queueKey));
            for (const entry of entries) {
                const k = queueKey(entry);
                if (!keys.has(k)) {
                    keys.add(k);
                    items.push(entry);
                }
            }
            write(items);
        },
        remove: (entries) => {
            const done = new Set(entries);
            write(read().filter((w) => !done.has(JSON.stringify(w))));
        },
    };
};

// Sends the queue in batches. Answered items (ok or refused) leave the queue;
// a network error or a non-OK answer stops and keeps the rest for the next try.
const flushQueue = async ({ queue, api, conn }) => {
    const all = [];
    for (;;) {
        const batch = queue.items().slice(0, SAVE_BATCH);
        if (batch.length === 0) return all;
        const { results } = await api.saveItems(conn, batch);
        queue.remove(batch.map((w) => JSON.stringify(w)));
        all.push(...(Array.isArray(results) ? results : []));
    }
};

const earliestDue = (cards) => {
    let earliest = null;
    for (const card of Array.isArray(cards) ? cards : []) {
        if (card && typeof card.dueAt === 'string' && (earliest === null || Date.parse(card.dueAt) < Date.parse(earliest))) {
            earliest = card.dueAt;
        }
    }
    return earliest;
};

// What the word card needs from an ApiItem: known (out of the review) or the next review.
const bankEntry = (item) => ({
    id: item.id,
    lemma: item.lemma,
    known: item.status === 'conhecido',
    dueAt: earliestDue(item.cards),
});

// Bank of one language, by lemma without case.
const indexBank = (items) => {
    const bank = new Map();
    for (const item of Array.isArray(items) ? items : []) {
        if (item && typeof item.lemma === 'string') bank.set(item.lemma.toLowerCase(), bankEntry(item));
    }
    return bank;
};

// Saved items of the bank's language go into it, so a second click shows "No seu banco".
const applySaveResults = (bank, results, language) => {
    for (const result of Array.isArray(results) ? results : []) {
        if (!result || !result.ok || !result.item || result.item.language !== language) continue;
        const { id, lemma, card } = result.item;
        const key = lemma.toLowerCase();
        const previous = bank.get(key);
        bank.set(key, previous ? { ...previous, id, lemma } : { id, lemma, known: false, dueAt: card ? card.dueAt : null });
    }
    return bank;
};

// preferWords from the server, as /annotate expects them: lowercase, unique, sorted.
const preferWordsOf = (preferWords) => [...new Set((Array.isArray(preferWords) ? preferWords : []).filter((w) => typeof w === 'string').map((w) => w.toLowerCase()))].sort();

// "Visto": bank words that showed up in a subtitle. stremio-video emits 'shown' on every render of a
// cue, so each (request, cue, lemma) counts once.
const createSeenTracker = () => {
    const noted = new Set();
    let pending = new Set();
    return {
        note: ({ requestId, cueId, annotations }, bank) => {
            for (const annotation of Array.isArray(annotations) ? annotations : []) {
                const lemma = (str(annotation.lemma) || str(annotation.target)).toLowerCase();
                if (!lemma || !bank.has(lemma)) continue;
                const k = `${requestId}\u0000${cueId}\u0000${lemma}`;
                if (noted.has(k)) continue;
                noted.add(k);
                pending.add(lemma);
            }
        },
        take: () => {
            const lemmas = [...pending];
            pending = new Set();
            return lemmas;
        },
    };
};

const pad = (n) => String(n).padStart(2, '0');

// "agora", "hoje às 18:05", "amanhã às 09:00", "em 5 dias" (local time of the player).
const formatNextReview = (dueAt, now = new Date()) => {
    const at = new Date(dueAt);
    if (dueAt === null || Number.isNaN(at.getTime())) return '';
    if (at.getTime() <= now.getTime()) return 'agora';
    const days = Math.round((Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    if (days === 0) return `hoje às ${time}`;
    if (days === 1) return `amanhã às ${time}`;
    return `em ${days} dias`;
};

module.exports = {
    DEFAULT_LINGUARUDO_URL,
    apiBaseUrl,
    createLinguarudoApi,
    newClientId,
    toApiWork,
    toApiItem,
    fromSavedWord,
    createSaveQueue,
    flushQueue,
    indexBank,
    applySaveResults,
    preferWordsOf,
    createSeenTracker,
    formatNextReview,
};
