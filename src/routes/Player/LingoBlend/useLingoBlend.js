// LingoBlend: player integration hook. Registers the provider while the player is mounted, owns the
// settings / status / saved words, and the word card opened by the `lingoblend:word` DOM event.

const React = require('react');
const lingoBlend = require('./api');
const { createProvider, toSourceLang } = require('./provider');
const { loadSettings, saveSettings, loadSavedWords, isWordSaved, saveWord, exportSavedWordsCSV } = require('./storage');
const { listenCardDismiss } = require('./cardDismiss');
const {
    createLinguarudoApi,
    createSaveQueue,
    flushQueue,
    createSeenTracker,
    toApiWord,
    fromSavedWord,
    indexBank,
    preferWordsOf,
} = require('./linguarudo');

const WORD_EVENT = 'lingoblend:word';
const IDLE_STATUS = { state: 'idle', annotated: 0, total: 0 };
const BANK_OFF = { state: 'off', email: null, error: null };
const RETRY_INTERVAL = 60 * 1000;
const SEEN_INTERVAL = 15 * 1000;
const SEEN_BATCH = 500;
const MIGRATED_KEY = 'lingoblend.linguarudoMigrated';

const linguarudoApi = createLinguarudoApi();

const bankErrorLabel = (error) => {
    if (error && error.status === 401) return 'token inválido ou revogado';
    if (error && error.offline) return 'Linguarudo fora do ar';
    return (error && error.message) || 'erro';
};

// Old local saves go to the bank once per (Linguarudo, token); the server skips duplicates.
const migrationMark = ({ url, token }) => `${url}|${token.slice(-8)}`;
const needsMigration = (conn) => {
    try {
        const marks = JSON.parse(window.localStorage.getItem(MIGRATED_KEY)) || [];
        return !marks.includes(migrationMark(conn));
    } catch (_error) {
        return true;
    }
};
const markMigrated = (conn) => {
    try {
        const marks = JSON.parse(window.localStorage.getItem(MIGRATED_KEY)) || [];
        window.localStorage.setItem(MIGRATED_KEY, JSON.stringify(marks.concat(migrationMark(conn)).slice(-20)));
    } catch (_error) {
        // ignore
    }
};

const getStatusLabel = (available, settings, status, progress) => {
    if (!available) return 'indisponível';
    if (!settings.enabled) return 'desativado';
    switch (status.state) {
        case 'loading': {
            const total = progress !== null ? progress.total : status.total;
            const done = progress !== null ? progress.done : status.annotated;
            return total > 0 ? `preparando… ${done}/${total}` : 'preparando…';
        }
        case 'ready':
            return 'pronto';
        case 'error':
            return `erro: ${status.error || 'servidor offline'}`;
        default:
            return 'aguardando legenda';
    }
};

const useLingoBlend = ({ video, title }) => {
    const available = lingoBlend !== null;
    const { containerRef: videoContainerRef, setPaused } = video;
    const [settings, setSettings] = React.useState(loadSettings);
    const [status, setStatus] = React.useState(() => {
        return available && typeof lingoBlend.getStatus === 'function' ? lingoBlend.getStatus() : IDLE_STATUS;
    });
    const [progress, setProgress] = React.useState(null);
    const [savedCount, setSavedCount] = React.useState(() => loadSavedWords().length);
    const [card, setCard] = React.useState(null);
    const [bank, setBank] = React.useState(BANK_OFF);
    const [queued, setQueued] = React.useState(0);

    const settingsRef = React.useRef(settings);
    const videoStateRef = React.useRef(video.state);
    videoStateRef.current = video.state;
    const titleRef = React.useRef(title);
    titleRef.current = title;
    const pausedByCardRef = React.useRef(false);

    // Linguarudo: connection, bank of the current target language, words to swap first.
    const queueRef = React.useRef(null);
    if (queueRef.current === null) {
        queueRef.current = createSaveQueue({ storage: window.localStorage });
    }
    const connRef = React.useRef(null);
    const bankRef = React.useRef(new Map());
    const preferRef = React.useRef([]);
    const seenRef = React.useRef(null);
    if (seenRef.current === null) {
        seenRef.current = createSeenTracker();
    }

    const updateSettings = React.useCallback((partial) => {
        const previous = settingsRef.current;
        const next = { ...previous, ...partial };
        settingsRef.current = next;
        setSettings(next);
        saveSettings(next);
        if (!available) return;

        if (next.enabled !== previous.enabled) {
            lingoBlend.setEnabled(next.enabled);
        }
        if (next.enabled && (next.targetLang !== previous.targetLang || next.density !== previous.density || next.serverUrl !== previous.serverUrl)) {
            lingoBlend.refresh();
        }
    }, [available]);

    // Provider registration, for the lifetime of the player.
    React.useEffect(() => {
        if (!available) return;

        const { provider, abort } = createProvider({
            getSettings: () => settingsRef.current,
            getPreferWords: () => preferRef.current,
            getPosition: () => {
                const { time, duration } = videoStateRef.current;
                return Number.isFinite(time) && Number.isFinite(duration) && duration > 0 ? time / duration : null;
            },
            onProgress: setProgress,
        });
        const onStatus = (nextStatus) => {
            setStatus(nextStatus);
            if (nextStatus.state !== 'loading') {
                setProgress(null);
            }
        };

        lingoBlend.on('status', onStatus);
        lingoBlend.setEnabled(settingsRef.current.enabled);
        lingoBlend.setProvider(provider);
        return () => {
            abort();
            lingoBlend.setProvider(null);
            lingoBlend.off('status', onStatus);
        };
    }, [available]);

    const applyBank = React.useCallback((words) => {
        bankRef.current = indexBank(words);
        const prefer = preferWordsOf(words).sort();
        const changed = prefer.join('\n') !== preferRef.current.join('\n');
        preferRef.current = prefer;
        // Annotations already on screen were picked without the bank: ask again.
        if (changed && available && settingsRef.current.enabled) {
            lingoBlend.refresh();
        }
    }, [available]);

    // Sends the save queue. Answers update the bank, so a second click shows "No seu banco".
    const flushSaves = React.useCallback(async () => {
        const conn = connRef.current;
        const queue = queueRef.current;
        if (conn === null || queue.items().length === 0) {
            setQueued(queue.items().length);
            return [];
        }
        try {
            const results = await flushQueue({ queue, api: linguarudoApi, conn });
            for (const result of results) {
                if (result.status !== 'invalid' && result.lang === settingsRef.current.targetLang) {
                    const key = result.term.toLowerCase();
                    const previous = bankRef.current.get(key);
                    bankRef.current.set(key, { ...previous, term: result.term, state: result.state, dueAt: result.dueAt, paused: previous ? previous.paused : false });
                }
            }
            return results;
        } finally {
            setQueued(queue.items().length);
        }
    }, []);

    const flushSeen = React.useCallback((extra) => {
        const conn = connRef.current;
        const terms = seenRef.current.take();
        if (conn === null || terms.length === 0) return;
        const lang = settingsRef.current.targetLang;
        for (let i = 0; i < terms.length; i += SEEN_BATCH) {
            linguarudoApi.markSeen(conn, lang, terms.slice(i, i + SEEN_BATCH), extra).catch((error) => {
                console.warn('LingoBlend: unable to send seen words', error);
            });
        }
    }, []);

    // Connect when there is a token; reload the bank when the URL, the token or the language change.
    React.useEffect(() => {
        const token = settings.linguarudoToken;
        if (!token) {
            connRef.current = null;
            setBank(BANK_OFF);
            applyBank([]);
            return;
        }

        const conn = { url: settings.linguarudoUrl, token };
        const lang = settings.targetLang;
        connRef.current = conn;
        let cancelled = false;
        setBank((previous) => ({ ...previous, state: 'connecting', error: null }));
        bankRef.current = new Map();

        (async () => {
            try {
                const { email } = await linguarudoApi.me(conn);
                if (cancelled) return;
                if (needsMigration(conn)) {
                    queueRef.current.add(loadSavedWords().map(fromSavedWord).filter(Boolean));
                    markMigrated(conn);
                }
                await flushSaves().catch((error) => console.warn('LingoBlend: queue kept for later', error));
                const { words } = await linguarudoApi.listWords(conn, lang);
                if (cancelled) return;
                applyBank(words);
                setBank({ state: 'connected', email, error: null });
            } catch (error) {
                if (cancelled) return;
                setBank({ state: 'error', email: null, error: bankErrorLabel(error) });
            }
        })();

        return () => {
            cancelled = true;
            flushSeen();
        };
    }, [settings.linguarudoUrl, settings.linguarudoToken, settings.targetLang, applyBank, flushSaves, flushSeen]);

    // Failed saves are retried every minute and when the network comes back.
    React.useEffect(() => {
        const retry = () => {
            flushSaves().catch((error) => console.warn('LingoBlend: retry failed, queue kept', error));
        };
        const interval = setInterval(retry, RETRY_INTERVAL);
        window.addEventListener('online', retry);
        return () => {
            clearInterval(interval);
            window.removeEventListener('online', retry);
        };
    }, [flushSaves]);

    // "Visto": bank words that appeared in the subtitles (does not touch the review schedule).
    React.useEffect(() => {
        if (!available) return;
        const onShown = (payload) => {
            if (connRef.current !== null) {
                seenRef.current.note(payload, bankRef.current);
            }
        };
        // Leaving the page (close the tab, go elsewhere) does not unmount React: flush on pagehide too.
        const onPageHide = () => flushSeen({ keepalive: true });
        lingoBlend.on('shown', onShown);
        window.addEventListener('pagehide', onPageHide);
        const interval = setInterval(() => flushSeen(), SEEN_INTERVAL);
        return () => {
            lingoBlend.off('shown', onShown);
            window.removeEventListener('pagehide', onPageHide);
            clearInterval(interval);
            flushSeen({ keepalive: true });
        };
    }, [available, flushSeen]);

    const closeCard = React.useCallback(() => {
        if (pausedByCardRef.current) {
            pausedByCardRef.current = false;
            setPaused(false);
        }
        setCard(null);
    }, [setPaused]);

    const saveCardWord = React.useCallback(() => {
        if (card === null || card.saved || card.bankWord) return;
        const { annotation } = card;
        const savedAt = new Date().toISOString();
        const title = typeof titleRef.current === 'string' ? titleRef.current : '';
        const word = {
            target: annotation.target,
            source: annotation.source,
            meaning: annotation.meaning || '',
            example: annotation.example || '',
            targetLang: card.targetLang,
            sourceLang: card.sourceLang,
            cueText: card.cueText || '',
            savedAt,
        };
        if (title.length > 0) {
            word.title = title;
        }
        setSavedCount(saveWord(word).length);

        if (connRef.current === null) {
            setCard({ ...card, saved: true });
            return;
        }
        // To the bank: queued first, so a failed request is retried later.
        queueRef.current.add([toApiWord({
            annotation,
            targetLang: card.targetLang,
            displayText: card.displayText,
            cueText: card.cueText,
            shownText: card.shownText,
            title,
            timeMs: card.timeMs,
            savedAt,
        })]);
        setQueued(queueRef.current.items().length);
        const key = card.key;
        setCard({ ...card, saved: true, pending: true });
        flushSaves()
            .then(() => setCard((current) => (current !== null && current.key === key ? { ...current, pending: false } : current)))
            .catch((error) => console.warn('LingoBlend: save kept in the queue', error));
    }, [card, flushSaves]);

    const exportCSV = React.useCallback(() => {
        exportSavedWordsCSV();
    }, []);

    // Word clicks from the subtitles rendered by stremio-video (CONTRACT.md section 3).
    React.useEffect(() => {
        const container = videoContainerRef.current;
        if (!container) return;

        const onWord = (event) => {
            const detail = event.detail || {};
            if (!detail.annotation) return;

            if (settingsRef.current.pauseOnClick && videoStateRef.current.paused === false) {
                pausedByCardRef.current = true;
                setPaused(true);
            }
            const targetLang = settingsRef.current.targetLang;
            const shownText = event.target instanceof Element ? event.target.textContent : '';
            const lemma = (detail.annotation.lemma || detail.annotation.target || '').toLowerCase();
            setCard({
                key: Date.now(),
                annotation: detail.annotation,
                cueText: detail.cueText,
                displayText: detail.displayText,
                shownText,
                timeMs: videoStateRef.current.time,
                bankWord: bankRef.current.get(lemma) || null,
                rect: detail.rect,
                anchor: event.target instanceof Element ? event.target : null,
                targetLang,
                sourceLang: toSourceLang(detail.lang),
                saved: isWordSaved({ target: detail.annotation.target, source: detail.annotation.source, targetLang }),
            });
        };

        container.addEventListener(WORD_EVENT, onWord);
        return () => container.removeEventListener(WORD_EVENT, onWord);
    }, [videoContainerRef, setPaused]);

    // While the card is open: Escape closes it (and must not reach the player's exit shortcut),
    // a mousedown outside of it closes it (see cardDismiss.js).
    const cardRef = React.useRef(null);
    const cardOpen = card !== null;
    React.useEffect(() => {
        if (!cardOpen) return;

        return listenCardDismiss({
            win: window,
            doc: document,
            isInsideCard: (target) => cardRef.current !== null && cardRef.current.contains(target),
            isInsideVideo: (target) => videoContainerRef.current !== null && videoContainerRef.current.contains(target),
            onClose: closeCard,
        });
    }, [cardOpen, closeCard, videoContainerRef]);

    return {
        available,
        settings,
        updateSettings,
        status,
        statusLabel: getStatusLabel(available, settings, status, progress),
        savedCount,
        exportCSV,
        bank: { ...bank, queued },
        card,
        cardRef,
        cardOpen,
        closeCard,
        saveCardWord,
    };
};

module.exports = useLingoBlend;
