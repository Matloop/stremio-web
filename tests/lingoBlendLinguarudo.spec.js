// LingoBlend ↔ Linguarudo (src/routes/Player/LingoBlend/linguarudo.js).

const {
    DEFAULT_LINGUARUDO_URL,
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
} = require('../src/routes/Player/LingoBlend/linguarudo');

const memoryStorage = () => {
    const data = new Map();
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
        data,
    };
};

const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
});

describe('apiBaseUrl', () => {
    test('produção por padrão; tira barras do fim', () => {
        expect(DEFAULT_LINGUARUDO_URL).toMatch(/^https:\/\//);
        expect(apiBaseUrl('')).toBe(DEFAULT_LINGUARUDO_URL);
        expect(apiBaseUrl('  http://localhost:5173/// ')).toBe('http://localhost:5173');
    });
});

describe('createLinguarudoApi', () => {
    test('manda Bearer e JSON para /api', async () => {
        const calls = [];
        const fetchImpl = async (url, init) => {
            calls.push({ url, init });
            return jsonResponse(200, { email: 'a@b.c' });
        };
        const api = createLinguarudoApi({ fetchImpl });
        const conn = { url: 'http://localhost:5173/', token: 'lr_abc' };
        await expect(api.me(conn)).resolves.toEqual({ email: 'a@b.c' });
        await api.saveWords(conn, [{ term: 'festa', lang: 'it' }]);
        await api.listWords(conn, 'it');
        await api.markSeen(conn, 'it', ['festa']);

        expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
            'GET http://localhost:5173/api/me',
            'POST http://localhost:5173/api/words',
            'GET http://localhost:5173/api/words?lang=it',
            'POST http://localhost:5173/api/words/seen',
        ]);
        expect(calls[0].init.headers.Authorization).toBe('Bearer lr_abc');
        expect(JSON.parse(calls[1].init.body)).toEqual({ words: [{ term: 'festa', lang: 'it' }] });
        expect(JSON.parse(calls[3].init.body)).toEqual({ lang: 'it', terms: ['festa'] });
    });

    test('erro HTTP vira Error com status e mensagem do servidor', async () => {
        const api = createLinguarudoApi({ fetchImpl: async () => jsonResponse(401, { message: 'Token inválido ou revogado.' }) });
        await expect(api.me({ url: 'http://x', token: 't' })).rejects.toMatchObject({ status: 401, message: 'Token inválido ou revogado.' });
    });

    test('falha de rede vira Error com offline', async () => {
        const api = createLinguarudoApi({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
        await expect(api.me({ url: 'http://x', token: 't' })).rejects.toMatchObject({ offline: true });
    });
});

describe('toApiWord', () => {
    const annotation = {
        source: 'festas',
        target: 'feste',
        lemma: 'festa',
        ipa: '/ˈfɛs.te/',
        pos: 'subst. fem. plural',
        meaning: 'festas, celebrações',
        example: 'Andiamo alle feste.',
    };

    test('guarda o lema; a forma vista fica no contexto e no destaque', () => {
        const word = toApiWord({
            annotation,
            targetLang: 'it',
            displayText: 'Eu não quero só ir às feste.',
            cueText: 'Eu não quero só ir às festas.',
            shownText: 'feste',
            title: 'Kaguya',
            timeMs: 2530900,
            savedAt: '2026-11-10T12:00:00.000Z',
        });
        expect(word).toEqual({
            term: 'festa',
            lang: 'it',
            translation: 'festas, celebrações',
            context: 'Eu não quero só ir às feste.',
            contextHighlight: 'feste',
            ipa: '/ˈfɛs.te/',
            pos: 'subst. fem. plural',
            meaning: 'festas, celebrações',
            example: 'Andiamo alle feste.',
            sourceTitle: 'Kaguya',
            sourceTimeS: 2530,
            savedAt: '2026-11-10T12:00:00.000Z',
        });
    });

    test('sem lema/meaning/displayText: cai no target, no source e no cueText', () => {
        const word = toApiWord({ annotation: { source: 'dias', target: 'giorni' }, targetLang: 'it', cueText: 'Bons dias.', savedAt: 'x' });
        expect(word).toMatchObject({ term: 'giorni', translation: 'dias', context: 'Bons dias.', contextHighlight: 'giorni', sourceTitle: '', sourceTimeS: null });
    });
});

describe('fromSavedWord', () => {
    test('converte o formato antigo de lingoblend.savedWords', () => {
        expect(fromSavedWord({
            target: 'feste', source: 'festas', meaning: 'festas', example: 'Ex.', targetLang: 'it', sourceLang: 'pt',
            cueText: 'Vamos às festas.', savedAt: '2026-11-01T00:00:00.000Z', title: 'Kaguya',
        })).toEqual({
            term: 'feste', lang: 'it', translation: 'festas', context: 'Vamos às festas.', contextHighlight: '',
            meaning: 'festas', example: 'Ex.', sourceTitle: 'Kaguya', savedAt: '2026-11-01T00:00:00.000Z',
        });
    });

    test('ignora línguas fora de EN/IT e itens sem target', () => {
        expect(fromSavedWord({ target: 'fiesta', targetLang: 'es' })).toBeNull();
        expect(fromSavedWord({ targetLang: 'it' })).toBeNull();
    });
});

describe('fila de envio', () => {
    const conn = { url: 'http://x', token: 't' };

    test('persiste no storage e tira duplicata de lang+term', () => {
        const storage = memoryStorage();
        const queue = createSaveQueue({ storage });
        queue.add([{ term: 'festa', lang: 'it' }, { term: 'Festa', lang: 'it' }, { term: 'festa', lang: 'en' }]);
        expect(createSaveQueue({ storage }).items().map((w) => `${w.lang}:${w.term}`)).toEqual(['it:festa', 'en:festa']);
    });

    test('flush: tira da fila o que o servidor respondeu e devolve os resultados', async () => {
        const storage = memoryStorage();
        const queue = createSaveQueue({ storage });
        queue.add([{ term: 'festa', lang: 'it' }, { term: 'giorno', lang: 'it' }, { term: '', lang: 'it' }]);
        const api = {
            saveWords: jest.fn(async (_conn, words) => ({
                results: words.map((w) => (w.term === '' ?
                    { term: null, status: 'invalid', error: 'term vazio' }
                    :
                    { term: w.term, lang: w.lang, status: w.term === 'festa' ? 'created' : 'duplicate', state: 0, dueAt: '2026-11-10T12:00:00Z' })),
            })),
        };
        const results = await flushQueue({ queue, api, conn });
        expect(results.map((r) => r.status)).toEqual(['created', 'duplicate', 'invalid']);
        expect(queue.items()).toEqual([]);
    });

    test('flush: falha de rede ou 5xx mantém tudo na fila para tentar depois', async () => {
        const queue = createSaveQueue({ storage: memoryStorage() });
        queue.add([{ term: 'festa', lang: 'it' }]);
        const offline = Object.assign(new Error('offline'), { offline: true });
        await expect(flushQueue({ queue, api: { saveWords: async () => { throw offline; } }, conn })).rejects.toBe(offline);
        expect(queue.items()).toHaveLength(1);
    });

    test('flush: lotes de até 200', async () => {
        const queue = createSaveQueue({ storage: memoryStorage() });
        queue.add(Array.from({ length: 450 }, (_, i) => ({ term: `w${i}`, lang: 'it' })));
        const sizes = [];
        const api = {
            saveWords: async (_conn, words) => {
                sizes.push(words.length);
                return { results: words.map((w) => ({ term: w.term, lang: w.lang, status: 'created', state: 0, dueAt: 'x' })) };
            },
        };
        await flushQueue({ queue, api, conn });
        expect(sizes).toEqual([200, 200, 50]);
        expect(queue.items()).toEqual([]);
    });

    test('flush sem fila não chama a API', async () => {
        const api = { saveWords: jest.fn() };
        await expect(flushQueue({ queue: createSaveQueue({ storage: memoryStorage() }), api, conn })).resolves.toEqual([]);
        expect(api.saveWords).not.toHaveBeenCalled();
    });
});

describe('banco e preferências', () => {
    const words = [
        { term: 'festa', state: 1, dueAt: '2026-11-10T12:00:00Z', paused: false, prefer: true },
        { term: 'Giorno', state: 0, dueAt: '2026-11-10T12:00:00Z', paused: false, prefer: false },
    ];

    test('indexBank: busca sem caixa', () => {
        const bank = indexBank(words);
        expect(bank.get('giorno').term).toBe('Giorno');
        expect(bank.has('casa')).toBe(false);
    });

    test('preferWordsOf: só as marcadas, em minúsculas', () => {
        expect(preferWordsOf(words)).toEqual(['festa']);
    });
});

describe('createSeenTracker', () => {
    test('nota cada (requestId, cue, lema) uma vez, só palavras do banco; take devolve termos únicos', () => {
        const bank = indexBank([{ term: 'festa' }, { term: 'giorno' }]);
        const tracker = createSeenTracker();
        const shown = (cueId, lemmas) => tracker.note({ requestId: 1, cueId, annotations: lemmas.map((lemma) => ({ lemma, target: lemma })) }, bank);
        shown('c1', ['festa', 'casa']);
        shown('c1', ['festa']);
        shown('c2', ['festa', 'Giorno']);
        expect(tracker.take()).toEqual(['festa', 'giorno']);
        expect(tracker.take()).toEqual([]);
        shown('c1', ['festa']);
        expect(tracker.take()).toEqual([]);
    });

    test('sem lema usa o target', () => {
        const tracker = createSeenTracker();
        tracker.note({ requestId: 2, cueId: 'c', annotations: [{ target: 'Festa' }] }, indexBank([{ term: 'festa' }]));
        expect(tracker.take()).toEqual(['festa']);
    });
});

describe('formatNextReview', () => {
    const now = new Date(2026, 10, 10, 15, 0);

    test('vencida, hoje, amanhã, dias', () => {
        expect(formatNextReview(new Date(2026, 10, 10, 14, 0).toISOString(), now)).toBe('agora');
        expect(formatNextReview(new Date(2026, 10, 10, 18, 5).toISOString(), now)).toBe('hoje às 18:05');
        expect(formatNextReview(new Date(2026, 10, 11, 9, 0).toISOString(), now)).toBe('amanhã às 09:00');
        expect(formatNextReview(new Date(2026, 10, 15, 9, 0).toISOString(), now)).toBe('em 5 dias');
    });

    test('data inválida', () => {
        expect(formatNextReview('x', now)).toBe('');
    });
});
