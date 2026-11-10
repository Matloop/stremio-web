// LingoBlend: player integration hook. Registers the provider while the player is mounted, owns the
// settings / status / saved words, and the word card opened by the `lingoblend:word` DOM event.

const React = require('react');
const lingoBlend = require('./api');
const { createProvider, toSourceLang } = require('./provider');
const { loadSettings, saveSettings, loadSavedWords, isWordSaved, saveWord, exportSavedWordsCSV } = require('./storage');

const WORD_EVENT = 'lingoblend:word';
const IDLE_STATUS = { state: 'idle', annotated: 0, total: 0 };

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

    const settingsRef = React.useRef(settings);
    const videoStateRef = React.useRef(video.state);
    videoStateRef.current = video.state;
    const titleRef = React.useRef(title);
    titleRef.current = title;
    const pausedByCardRef = React.useRef(false);

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

    const closeCard = React.useCallback(() => {
        if (pausedByCardRef.current) {
            pausedByCardRef.current = false;
            setPaused(false);
        }
        setCard(null);
    }, [setPaused]);

    const saveCardWord = React.useCallback(() => {
        if (card === null || card.saved) return;
        const { annotation } = card;
        const word = {
            target: annotation.target,
            source: annotation.source,
            meaning: annotation.meaning || '',
            example: annotation.example || '',
            targetLang: card.targetLang,
            sourceLang: card.sourceLang,
            cueText: card.cueText || '',
            savedAt: new Date().toISOString(),
        };
        if (typeof titleRef.current === 'string' && titleRef.current.length > 0) {
            word.title = titleRef.current;
        }
        setSavedCount(saveWord(word).length);
        setCard({ ...card, saved: true });
    }, [card]);

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
            setCard({
                key: Date.now(),
                annotation: detail.annotation,
                cueText: detail.cueText,
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
    // a mousedown outside of it closes it.
    const cardRef = React.useRef(null);
    const cardOpen = card !== null;
    React.useEffect(() => {
        if (!cardOpen) return;

        const onKeyDown = (event) => {
            if (event.key === 'Escape' || event.code === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeCard();
            }
        };
        const onMouseDown = (event) => {
            if (cardRef.current && cardRef.current.contains(event.target)) return;
            closeCard();
        };

        window.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('mousedown', onMouseDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('mousedown', onMouseDown);
        };
    }, [cardOpen, closeCard]);

    return {
        available,
        settings,
        updateSettings,
        status,
        statusLabel: getStatusLabel(available, settings, status, progress),
        savedCount,
        exportCSV,
        card,
        cardRef,
        cardOpen,
        closeCard,
        saveCardWord,
    };
};

module.exports = useLingoBlend;
