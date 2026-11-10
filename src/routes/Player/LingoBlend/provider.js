// LingoBlend: provider registered with lingoBlend.setProvider (docs/CONTRACT.md sections 2 and 4).
// Splits the cues in batches, POSTs them to `${serverUrl}/annotate` with limited concurrency and
// pushes every batch result through update().

const { find: findLanguage } = require('stremio/common/languages');

const BATCH_SIZE = 80;
const CONCURRENCY = 3;
const REQUEST_TIMEOUT = 90 * 1000;

const OFFLINE_MESSAGE = 'servidor offline';

// Track `lang` comes from addons / embedded metadata: 'por', 'pob', 'pt-BR', 'pt', ...
// The server accepts ISO 639-1 or 639-2, prefer 639-1.
const toSourceLang = (lang) => {
    if (typeof lang !== 'string' || lang.trim().length === 0) {
        return 'pt';
    }

    const code = lang.trim().toLowerCase();
    if (code === 'pob' || code === 'pb' || code === 'ptbr') {
        return 'pt';
    }

    const language = findLanguage(code) || findLanguage(code.split(/[-_]/)[0]);
    return language && typeof language.alpha2 === 'string' ? language.alpha2 : code.split(/[-_]/)[0];
};

const chunk = (items, size) => {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push({ start: i, cues: items.slice(i, i + size) });
    }
    return chunks;
};

// Cue ids are assigned in time order, so the playback position (fraction of the duration) gives an
// estimate of which batch is on screen now. Start there, then alternate forward/backward with a
// forward bias (the user is moving forward).
const prioritize = (batches, position) => {
    if (batches.length <= 1 || typeof position !== 'number' || !Number.isFinite(position) || position <= 0) {
        return batches;
    }

    const total = batches[batches.length - 1].start + batches[batches.length - 1].cues.length;
    const current = Math.min(batches.length - 1, Math.floor(Math.min(1, position) * total / BATCH_SIZE));
    const ordered = [batches[current]];
    let forward = current + 1;
    let backward = current - 1;
    while (ordered.length < batches.length) {
        for (let i = 0; i < 2 && forward < batches.length; i++) {
            ordered.push(batches[forward++]);
        }
        if (backward >= 0) {
            ordered.push(batches[backward--]);
        }
    }
    return ordered;
};

const annotateBatch = async ({ serverUrl, body, signal }) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort);
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
        let response;
        try {
            response = await fetch(`${serverUrl.replace(/\/+$/, '')}/annotate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
        } catch (error) {
            if (signal.aborted) throw error;
            const offline = new Error(OFFLINE_MESSAGE);
            offline.offline = true;
            offline.cause = error;
            throw offline;
        }

        if (!response.ok) {
            // Server errors come back as { error } (400/413/502).
            let message = null;
            try {
                const body = await response.json();
                message = body && typeof body.error === 'string' && body.error.length > 0 ? body.error : null;
            } catch (_error) {
                // not JSON
            }
            throw new Error(message || `servidor respondeu ${response.status}`);
        }

        const result = await response.json();
        return result && result.annotations && typeof result.annotations === 'object' ? result.annotations : {};
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
    }
};

// getSettings(): current LingoBlend settings; getPosition(): playback position in [0, 1] or null;
// onProgress({ done, total }): processed cues so far for the current request;
// getPreferWords(): lemmas from the Linguarudo bank to swap first (learning / due), may be empty.
const createProvider = ({ getSettings, getPosition, onProgress, getPreferWords = () => [] }) => {
    let currentController = null;

    const provider = async (request, update) => {
        if (currentController !== null) {
            currentController.abort();
        }
        const controller = new AbortController();
        currentController = controller;
        const { signal } = controller;

        const settings = getSettings();
        const cues = Array.isArray(request.cues) ? request.cues : [];
        const total = cues.length;
        let done = 0;
        const reportProgress = () => {
            if (currentController === controller) {
                onProgress({ requestId: request.requestId, done, total });
            }
        };
        reportProgress();

        const queue = prioritize(chunk(cues, BATCH_SIZE), getPosition());
        const sourceLang = toSourceLang(request.lang);
        const preferWords = getPreferWords();
        const errors = [];

        const worker = async () => {
            while (queue.length > 0 && !signal.aborted) {
                const batch = queue.shift();
                try {
                    const annotations = await annotateBatch({
                        serverUrl: settings.serverUrl,
                        signal,
                        body: {
                            sourceLang,
                            targetLang: settings.targetLang,
                            density: settings.density / 100,
                            cues: batch.cues,
                            ...(Array.isArray(preferWords) && preferWords.length > 0 ? { preferWords } : {}),
                        },
                    });
                    if (signal.aborted) return;
                    // update() returns false when the request became stale (track change, refresh).
                    if (update(annotations) === false) {
                        controller.abort();
                        return;
                    }
                } catch (error) {
                    if (signal.aborted) return;
                    errors.push(error);
                    // Server unreachable: no point in hammering it with the remaining batches.
                    if (error.offline) {
                        queue.length = 0;
                    }
                }
                done += batch.cues.length;
                reportProgress();
            }
        };

        try {
            await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
        } finally {
            if (currentController === controller) {
                currentController = null;
            }
        }

        if (signal.aborted) {
            // Stale request; lingoBlend ignores whatever we return.
            return {};
        }
        if (errors.length > 0) {
            const offline = errors.find((error) => error.offline);
            throw offline || errors[0];
        }
        return {};
    };

    const abort = () => {
        if (currentController !== null) {
            currentController.abort();
            currentController = null;
        }
    };

    return { provider, abort };
};

module.exports = {
    createProvider,
    toSourceLang,
    OFFLINE_MESSAGE,
};
