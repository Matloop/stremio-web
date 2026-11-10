// LingoBlend UI strings (Portuguese, hardcoded on purpose: personal fork, outside stremio-translations).

// Rótulo da palavra original no cartão, pelo idioma da legenda (ISO 639-1).
const SOURCE_LANGUAGE_LABELS = {
    pt: 'Em português',
    en: 'Em inglês',
    es: 'Em espanhol',
    fr: 'Em francês',
    de: 'Em alemão',
    it: 'Em italiano',
};

module.exports = {
    TITLE: 'LingoBlend',
    ENABLED: 'Ativado',
    LEARNING: 'Aprendendo',
    DENSITY: 'Palavras trocadas',
    PAUSE_ON_CLICK: 'Pausar ao clicar',
    SERVER: 'Servidor',
    SAVED_WORDS: 'Palavras salvas:',
    EXPORT_CSV: 'Exportar CSV',
    IN_LANGUAGE: (code) => `${SOURCE_LANGUAGE_LABELS[code] || 'No original'}:`,
    LISTEN: 'Ouvir pronúncia',
    SAVE_WORD: '＋ Salvar palavra',
    SAVED: '✓ Salva',
    CONTINUE: 'Continuar ▶',
};
