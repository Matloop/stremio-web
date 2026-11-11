// LingoBlend ↔ Linguarudo (src/routes/Player/LingoBlend/linguarudo.js).

const {
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
} = require('../src/routes/Player/LingoBlend/linguarudo');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

const item = (language, lemma, clientId) => ({ language, lemma, encounter: clientId ? { clientId } : undefined });

describe('apiBaseUrl', () => {
    test('produção por padrão; tira barras do fim', () => {
        expect(DEFAULT_LINGUARUDO_URL).toMatch(/^https:\/\//);
        expect(apiBaseUrl('')).toBe(DEFAULT_LINGUARUDO_URL);
        expect(apiBaseUrl('  http://localhost:5173/// ')).toBe('http://localhost:5173');
    });
});

describe('createLinguarudoApi', () => {
    test('manda Bearer e JSON para /api/v1', async () => {
        const calls = [];
        const fetchImpl = async (url, init) => {
            calls.push({ url, init });
            return jsonResponse(200, { email: 'a@b.c' });
        };
        const api = createLinguarudoApi({ fetchImpl });
        const conn = { url: 'http://localhost:5173/', token: 'lr_abc' };
        await expect(api.me(conn)).resolves.toEqual({ email: 'a@b.c' });
        await api.saveItems(conn, [{ language: 'it', lemma: 'festa' }]);
        await api.listItems(conn, 'it');
        await api.markSeen(conn, 'it', ['festa']);

        expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
            'GET http://localhost:5173/api/v1/me',
            'POST http://localhost:5173/api/v1/items',
            'GET http://localhost:5173/api/v1/items?language=it',
            'POST http://localhost:5173/api/v1/items/seen',
        ]);
        expect(calls[0].init.headers.Authorization).toBe('Bearer lr_abc');
        expect(JSON.parse(calls[1].init.body)).toEqual({ items: [{ language: 'it', lemma: 'festa' }] });
        expect(JSON.parse(calls[3].init.body)).toEqual({ language: 'it', lemmas: ['festa'] });
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

describe('newClientId', () => {
    test('UUID v4, diferente a cada chamada', () => {
        const a = newClientId();
        expect(a).toMatch(UUID);
        expect(newClientId()).not.toBe(a);
    });

    test('sem randomUUID (contexto não seguro) usa getRandomValues', () => {
        const original = globalThis.crypto;
        Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: (b) => original.getRandomValues(b) }, configurable: true });
        try {
            expect(newClientId()).toMatch(UUID);
        } finally {
            Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
        }
    });
});

describe('toApiWork', () => {
    test('episódio: título da série, T/E e refs do IMDb', () => {
        expect(toApiWork({ metaItem: { id: 'tt1234567', type: 'series', name: 'Kaguya' }, seriesInfo: { season: 1, episode: 2 }, title: 'Kaguya - S1E2' })).toEqual({
            kind: 'episodio',
            title: 'Kaguya',
            subtitle: 'T1E2',
            refs: { imdbId: 'tt1234567', season: 1, episode: 2 },
        });
    });

    test('filme', () => {
        expect(toApiWork({ metaItem: { id: 'tt7654321', type: 'movie', name: 'Um Filme' }, seriesInfo: null })).toEqual({
            kind: 'filme', title: 'Um Filme', subtitle: '', refs: { imdbId: 'tt7654321' },
        });
    });

    test('sem IMDb: obra sem refs; sem meta: usa o título do player como vídeo', () => {
        expect(toApiWork({ metaItem: { id: 'kitsu:1', type: 'series', name: 'Anime' }, seriesInfo: { season: 1, episode: 3 } })).toEqual({
            kind: 'episodio', title: 'Anime', subtitle: 'T1E3', refs: {},
        });
        expect(toApiWork({ metaItem: null, seriesInfo: null, title: 'arquivo.mkv' })).toEqual({ kind: 'video', title: 'arquivo.mkv', subtitle: '', refs: {} });
        expect(toApiWork({ metaItem: null, seriesInfo: null, title: '' })).toBeNull();
    });
});

describe('toApiItem', () => {
    const annotation = {
        source: 'festas',
        target: 'feste',
        lemma: 'festa',
        ipa: '/ˈfɛs.te/',
        pos: 'subst. fem. plural',
        meaning: 'festas, celebrações',
        example: 'Andiamo alle feste.',
    };
    const work = { kind: 'episodio', title: 'Kaguya', subtitle: 'T1E2', refs: { imdbId: 'tt1234567', season: 1, episode: 2 } };

    test('item pelo lema; a forma vista, a frase e o momento vão no encontro', () => {
        expect(toApiItem({
            annotation,
            targetLang: 'it',
            displayText: 'Eu não quero só ir às feste.',
            cueText: 'Eu não quero só ir às festas.',
            shownText: 'feste',
            timeMs: 2530900,
            seenAt: '2026-11-10T12:00:00.000Z',
            clientId: 'c1',
            work,
        })).toEqual({
            language: 'it',
            lemma: 'festa',
            sense: 'festas, celebrações',
            ipa: '/ˈfɛs.te/',
            partOfSpeech: 'subst. fem. plural',
            encounter: {
                form: 'feste',
                sentence: 'Eu não quero só ir às feste.',
                highlight: 'feste',
                sense: 'festas',
                position: { seconds: 2530 },
                seenAt: '2026-11-10T12:00:00.000Z',
                clientId: 'c1',
                origin: 'stremio',
            },
            work,
        });
    });

    test('sem lema/meaning/displayText/obra: cai no target, no source e no cueText', () => {
        const saved = toApiItem({ annotation: { source: 'dias', target: 'giorni' }, targetLang: 'it', cueText: 'Bons dias.', seenAt: 'x', clientId: 'c2', work: null });
        expect(saved).toMatchObject({ lemma: 'giorni', sense: 'dias', encounter: { form: 'giorni', sentence: 'Bons dias.', highlight: 'giorni', position: {} } });
        expect(saved).not.toHaveProperty('work');
    });
});

describe('fromSavedWord', () => {
    test('converte o formato antigo de lingoblend.savedWords', () => {
        expect(fromSavedWord({
            target: 'feste', source: 'festas', meaning: 'festas', example: 'Ex.', targetLang: 'it', sourceLang: 'pt',
            cueText: 'Vamos às festas.', savedAt: '2026-11-01T00:00:00.000Z', title: 'Kaguya',
        }, 'c1')).toEqual({
            language: 'it',
            lemma: 'feste',
            sense: 'festas',
            encounter: { form: 'feste', sentence: 'Vamos às festas.', highlight: '', sense: 'festas', seenAt: '2026-11-01T00:00:00.000Z', clientId: 'c1', origin: 'stremio' },
            work: { kind: 'video', title: 'Kaguya' },
        });
    });

    test('qualquer idioma; ignora itens sem target ou sem idioma', () => {
        expect(fromSavedWord({ target: 'fiesta', targetLang: 'es' }, 'c')).toMatchObject({ language: 'es', lemma: 'fiesta' });
        expect(fromSavedWord({ targetLang: 'it' }, 'c')).toBeNull();
        expect(fromSavedWord({ target: 'x' }, 'c')).toBeNull();
    });
});

describe('fila de envio', () => {
    const conn = { url: 'http://x', token: 't' };

    test('persiste no storage; um por clientId, ou por idioma+lema sem encontro', () => {
        const storage = memoryStorage();
        const queue = createSaveQueue({ storage });
        queue.add([item('it', 'festa'), item('it', 'Festa'), item('en', 'festa'), item('it', 'festa', 'c1'), item('it', 'festa', 'c2'), item('it', 'festa', 'c1')]);
        expect(createSaveQueue({ storage }).items().map((w) => `${w.language}:${w.lemma}:${w.encounter ? w.encounter.clientId : ''}`)).toEqual([
            'it:festa:', 'en:festa:', 'it:festa:c1', 'it:festa:c2',
        ]);
    });

    test('flush: tira da fila o que o servidor respondeu e devolve os resultados', async () => {
        const queue = createSaveQueue({ storage: memoryStorage() });
        queue.add([item('it', 'festa'), item('it', 'giorno'), item('it', '')]);
        const api = {
            saveItems: jest.fn(async (_conn, items) => ({
                results: items.map((w) => (w.lemma === '' ?
                    { ok: false, error: 'lemma vazio' }
                    :
                    { ok: true, item: { id: w.lemma, language: w.language, lemma: w.lemma, created: w.lemma === 'festa', encounterId: null, card: { state: 0, dueAt: '2026-11-10T12:00:00Z' } } })),
            })),
        };
        const results = await flushQueue({ queue, api, conn });
        expect(results.map((r) => (r.ok ? r.item.created : r.error))).toEqual([true, false, 'lemma vazio']);
        expect(queue.items()).toEqual([]);
    });

    test('flush: falha de rede ou 5xx mantém tudo na fila para tentar depois', async () => {
        const queue = createSaveQueue({ storage: memoryStorage() });
        queue.add([item('it', 'festa')]);
        const offline = Object.assign(new Error('offline'), { offline: true });
        await expect(flushQueue({ queue, api: { saveItems: async () => { throw offline; } }, conn })).rejects.toBe(offline);
        expect(queue.items()).toHaveLength(1);
    });

    test('flush: lotes de até 200', async () => {
        const queue = createSaveQueue({ storage: memoryStorage() });
        queue.add(Array.from({ length: 450 }, (_, i) => item('it', `w${i}`)));
        const sizes = [];
        const api = {
            saveItems: async (_conn, items) => {
                sizes.push(items.length);
                return { results: items.map(() => ({ ok: false, error: 'x' })) };
            },
        };
        await flushQueue({ queue, api, conn });
        expect(sizes).toEqual([200, 200, 50]);
        expect(queue.items()).toEqual([]);
    });

    test('flush sem fila não chama a API', async () => {
        const api = { saveItems: jest.fn() };
        await expect(flushQueue({ queue: createSaveQueue({ storage: memoryStorage() }), api, conn })).resolves.toEqual([]);
        expect(api.saveItems).not.toHaveBeenCalled();
    });
});

describe('banco e preferências', () => {
    const items = [
        { id: 'a', lemma: 'festa', status: 'ativo', cards: [{ kind: 'reconhecer', state: 2, dueAt: '2026-11-20T12:00:00Z' }, { kind: 'produzir', state: 1, dueAt: '2026-11-12T12:00:00Z' }] },
        { id: 'b', lemma: 'Giorno', status: 'conhecido', cards: [{ kind: 'reconhecer', state: 0, dueAt: '2026-11-10T12:00:00Z' }] },
    ];

    test('indexBank: busca sem caixa; conhecido e a revisão mais próxima', () => {
        const bank = indexBank(items);
        expect(bank.get('festa')).toEqual({ id: 'a', lemma: 'festa', known: false, dueAt: '2026-11-12T12:00:00Z' });
        expect(bank.get('giorno')).toMatchObject({ lemma: 'Giorno', known: true });
        expect(bank.has('casa')).toBe(false);
    });

    test('applySaveResults: item novo do idioma entra; existente mantém o estado; outro idioma e erro ficam de fora', () => {
        const bank = indexBank(items);
        const saved = (language, lemma, id) => ({ ok: true, item: { id, language, lemma, created: true, encounterId: 'e', card: { state: 0, dueAt: '2026-11-11T00:00:00Z' } } });
        applySaveResults(bank, [saved('it', 'Casa', 'c'), saved('it', 'giorno', 'b'), saved('en', 'house', 'h'), { ok: false, error: 'lemma vazio' }], 'it');
        expect(bank.get('casa')).toEqual({ id: 'c', lemma: 'Casa', known: false, dueAt: '2026-11-11T00:00:00Z' });
        expect(bank.get('giorno')).toMatchObject({ known: true });
        expect(bank.has('house')).toBe(false);
    });

    test('preferWordsOf: lista do servidor em minúsculas, sem repetição, ordenada', () => {
        expect(preferWordsOf(['giorno', 'Festa', 'festa', 3])).toEqual(['festa', 'giorno']);
        expect(preferWordsOf(undefined)).toEqual([]);
    });
});

describe('createSeenTracker', () => {
    test('nota cada (requestId, cue, lema) uma vez, só palavras do banco; take devolve lemas únicos', () => {
        const bank = indexBank([{ lemma: 'festa' }, { lemma: 'giorno' }]);
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
        tracker.note({ requestId: 2, cueId: 'c', annotations: [{ target: 'Festa' }] }, indexBank([{ lemma: 'festa' }]));
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

    test('data inválida ou ausente', () => {
        expect(formatNextReview('x', now)).toBe('');
        expect(formatNextReview(null, now)).toBe('');
    });
});
