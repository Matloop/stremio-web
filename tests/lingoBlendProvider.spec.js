// LingoBlend provider (preferWords) and settings (EN/IT, Linguarudo URL and token).

jest.mock('stremio/common/languages', () => ({ find: () => null }), { virtual: true });

const { createProvider } = require('../src/routes/Player/LingoBlend/provider');
const { sanitizeSettings, TARGET_LANGUAGES, DEFAULT_SETTINGS } = require('../src/routes/Player/LingoBlend/storage');
const { DEFAULT_LINGUARUDO_URL } = require('../src/routes/Player/LingoBlend/linguarudo');

const settings = { targetLang: 'it', density: 10, serverUrl: 'http://localhost:7979' };
const request = { requestId: 1, lang: 'pt', cues: [{ id: 'c1', text: 'Vamos às festas.' }] };

const run = async (getPreferWords) => {
    const bodies = [];
    global.fetch = jest.fn(async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ annotations: {} }) };
    });
    const { provider } = createProvider({ getSettings: () => settings, getPosition: () => null, onProgress: () => {}, getPreferWords });
    await provider(request, () => true);
    return bodies;
};

afterEach(() => {
    delete global.fetch;
});

describe('provider: preferWords', () => {
    test('manda as palavras do banco quando há', async () => {
        const [body] = await run(() => ['festa', 'giorno']);
        expect(body.preferWords).toEqual(['festa', 'giorno']);
        expect(body).toMatchObject({ sourceLang: 'pt', targetLang: 'it', density: 0.1 });
    });

    test('sem banco o corpo fica como antes', async () => {
        const [withEmpty] = await run(() => []);
        const [withoutGetter] = await run(undefined);
        expect('preferWords' in withEmpty).toBe(false);
        expect('preferWords' in withoutGetter).toBe(false);
    });
});

describe('settings', () => {
    test('só EN e IT', () => {
        expect(TARGET_LANGUAGES.map((l) => l.code).sort()).toEqual(['en', 'it']);
        expect(sanitizeSettings({ targetLang: 'es' }).targetLang).toBe(DEFAULT_SETTINGS.targetLang);
        expect(sanitizeSettings({ targetLang: 'en' }).targetLang).toBe('en');
    });

    test('URL do Linguarudo começa em produção e aceita outra; token é guardado sem espaços', () => {
        expect(sanitizeSettings(null)).toMatchObject({ linguarudoUrl: DEFAULT_LINGUARUDO_URL, linguarudoToken: '' });
        expect(sanitizeSettings({ linguarudoUrl: ' http://localhost:5173 ', linguarudoToken: ' lr_x ' })).toMatchObject({
            linguarudoUrl: 'http://localhost:5173',
            linguarudoToken: 'lr_x',
        });
        expect(sanitizeSettings({ linguarudoUrl: '  ' }).linguarudoUrl).toBe(DEFAULT_LINGUARUDO_URL);
    });
});
