// LingoBlend: settings and saved words persisted in localStorage.

const SETTINGS_KEY = 'lingoblend.settings';
const SAVED_WORDS_KEY = 'lingoblend.savedWords';

const TARGET_LANGUAGES = [
    { code: 'it', label: 'Italiano', voice: 'it-IT' },
    { code: 'es', label: 'Espanhol', voice: 'es-ES' },
    { code: 'en', label: 'Inglês', voice: 'en-US' },
    { code: 'fr', label: 'Francês', voice: 'fr-FR' },
    { code: 'de', label: 'Alemão', voice: 'de-DE' },
];

const DENSITY_MIN = 5;
const DENSITY_MAX = 30;

const DEFAULT_SETTINGS = {
    enabled: true,
    targetLang: 'it',
    density: 10,
    pauseOnClick: true,
    serverUrl: 'http://localhost:7979',
};

const readJSON = (key, fallback) => {
    try {
        const value = window.localStorage.getItem(key);
        return value !== null ? JSON.parse(value) : fallback;
    } catch (_error) {
        return fallback;
    }
};

const writeJSON = (key, value) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn('LingoBlend: unable to persist', key, error);
    }
};

const sanitizeSettings = (value) => {
    const settings = { ...DEFAULT_SETTINGS };
    if (value !== null && typeof value === 'object') {
        if (typeof value.enabled === 'boolean') settings.enabled = value.enabled;
        if (TARGET_LANGUAGES.some(({ code }) => code === value.targetLang)) settings.targetLang = value.targetLang;
        if (Number.isFinite(value.density)) settings.density = Math.round(Math.min(DENSITY_MAX, Math.max(DENSITY_MIN, value.density)));
        if (typeof value.pauseOnClick === 'boolean') settings.pauseOnClick = value.pauseOnClick;
        if (typeof value.serverUrl === 'string' && value.serverUrl.trim().length > 0) settings.serverUrl = value.serverUrl.trim();
    }
    return settings;
};

const loadSettings = () => sanitizeSettings(readJSON(SETTINGS_KEY, null));

const saveSettings = (settings) => writeJSON(SETTINGS_KEY, sanitizeSettings(settings));

const loadSavedWords = () => {
    const words = readJSON(SAVED_WORDS_KEY, []);
    return Array.isArray(words) ? words.filter((word) => word !== null && typeof word === 'object') : [];
};

const isSameWord = (a, b) => a.target === b.target && a.source === b.source && a.targetLang === b.targetLang;

const isWordSaved = (word) => loadSavedWords().some((saved) => isSameWord(saved, word));

const saveWord = (word) => {
    const words = loadSavedWords();
    if (!words.some((saved) => isSameWord(saved, word))) {
        words.push(word);
        writeJSON(SAVED_WORDS_KEY, words);
    }
    return words;
};

const CSV_COLUMNS = ['target', 'source', 'meaning', 'example', 'targetLang', 'sourceLang', 'cueText', 'savedAt', 'title'];

const csvValue = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const exportSavedWordsCSV = () => {
    const words = loadSavedWords();
    const rows = [CSV_COLUMNS.join(',')].concat(words.map((word) => CSV_COLUMNS.map((column) => csvValue(word[column])).join(',')));
    // BOM so spreadsheet apps detect UTF-8 (accents, IPA).
    const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lingoblend-palavras-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const languageByCode = (code) => TARGET_LANGUAGES.find((language) => language.code === code) || null;

module.exports = {
    TARGET_LANGUAGES,
    DENSITY_MIN,
    DENSITY_MAX,
    DEFAULT_SETTINGS,
    loadSettings,
    saveSettings,
    loadSavedWords,
    isWordSaved,
    saveWord,
    exportSavedWordsCSV,
    languageByCode,
};
