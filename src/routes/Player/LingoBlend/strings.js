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
    SAVED_PENDING: '✓ Salva · envio pendente',
    IN_BANK: 'No seu banco',
    NEXT_REVIEW: (when) => `Próxima revisão: ${when}`,
    KNOWN: 'Você já conhece',
    LINGUARUDO: 'Linguarudo',
    LINGUARUDO_URL: 'URL do Linguarudo',
    LINGUARUDO_URL_LABEL: 'URL',
    LINGUARUDO_TOKEN: 'Token do Linguarudo',
    LINGUARUDO_TOKEN_LABEL: 'Token',
    LINGUARUDO_TOKEN_PLACEHOLDER: 'cole o token de Integrações',
    LINGUARUDO_STATUS: (bank) => {
        const queued = bank.queued > 0 ? ` · ${bank.queued} na fila` : '';
        switch (bank.state) {
            case 'connecting': return `conectando…${queued}`;
            case 'connected': return `conectado como ${bank.email || '?'}${queued}`;
            case 'error': return `erro: ${bank.error}${queued}`;
            default: return 'sem token: palavras ficam só neste navegador';
        }
    },
    CONTINUE: 'Continuar ▶',
};
