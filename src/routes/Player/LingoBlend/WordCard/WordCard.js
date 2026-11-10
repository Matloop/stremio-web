// LingoBlend: card shown above a clicked subtitle word (design/mockup.html `.pop`).

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { default: Button } = require('stremio/components/Button');
const { languageByCode } = require('../storage');
const { formatNextReview } = require('../linguarudo');
const STRINGS = require('../strings');
const styles = require('./styles');

const MARGIN = 8;
const GAP = 12;
const REANCHOR_INTERVAL = 250;

const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

const speak = (text, targetLang) => {
    if (!speechAvailable) return;
    const synth = window.speechSynthesis;
    const lang = languageByCode(targetLang)?.voice ?? targetLang;
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    const voices = synth.getVoices();
    const normalize = (value) => String(value || '').replace('_', '-').toLowerCase();
    const voice = voices.find((voice) => normalize(voice.lang) === normalize(lang)) ||
        voices.find((voice) => normalize(voice.lang).startsWith(`${targetLang}-`) || normalize(voice.lang) === targetLang);
    if (voice) {
        utterance.voice = voice;
    }
    synth.cancel();
    synth.speak(utterance);
};

const escapeAttribute = (value) => {
    return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
};

// The subtitles may be re-rendered (or move when the control bar shows up) while the card is open:
// prefer the live word element, fall back to the rect captured at click time.
const findAnchorRect = (card, container) => {
    if (card.anchor && card.anchor.isConnected) {
        return card.anchor.getBoundingClientRect();
    }
    const element = container.querySelector(`.lingoblend-word[data-lingoblend-source="${escapeAttribute(card.annotation.source)}"]`);
    if (element) {
        return element.getBoundingClientRect();
    }
    return card.rect || null;
};

const WordCard = ({ className, card, containerRef, cardRef, onSave, onClose }) => {
    const { annotation, targetLang, saved, pending, bankWord } = card;
    const [position, setPosition] = React.useState(null);

    const updatePosition = React.useCallback(() => {
        const container = containerRef.current;
        const element = cardRef.current;
        if (!container || !element) return;

        const anchor = findAnchorRect(card, container);
        const containerRect = container.getBoundingClientRect();
        // getBoundingClientRect is in screen px while left/top are CSS px of the (possibly zoomed) page.
        const scale = container.offsetWidth > 0 ? containerRect.width / container.offsetWidth : 1;
        const width = element.offsetWidth;
        const height = element.offsetHeight;
        const containerWidth = container.offsetWidth;
        let next;
        if (anchor) {
            const anchorX = (anchor.left - containerRect.left + anchor.width / 2) / scale;
            const anchorTop = (anchor.top - containerRect.top) / scale;
            const anchorBottom = (anchor.bottom - containerRect.top) / scale;
            const left = Math.max(MARGIN, Math.min(anchorX - width / 2, containerWidth - width - MARGIN));
            const below = anchorTop - height - GAP < MARGIN;
            const top = below ? anchorBottom + GAP : anchorTop - height - GAP;
            next = { left, top, arrow: Math.max(14, Math.min(anchorX - left, width - 14)), below };
        } else {
            next = { left: (containerWidth - width) / 2, top: container.offsetHeight / 2 - height, arrow: width / 2, below: false };
        }
        setPosition((previous) => {
            return previous !== null &&
                Math.abs(previous.left - next.left) < 0.5 &&
                Math.abs(previous.top - next.top) < 0.5 &&
                Math.abs(previous.arrow - next.arrow) < 0.5 &&
                previous.below === next.below ? previous : next;
        });
    }, [card, containerRef, cardRef]);

    React.useLayoutEffect(() => {
        updatePosition();
        const interval = setInterval(updatePosition, REANCHOR_INTERVAL);
        window.addEventListener('resize', updatePosition);
        return () => {
            clearInterval(interval);
            window.removeEventListener('resize', updatePosition);
        };
    }, [updatePosition]);

    // Keep the card's own events away from the video (play/pause, fullscreen) and the player hold handlers.
    const stopPropagation = React.useCallback((event) => {
        event.stopPropagation();
    }, []);

    const onSpeakClick = React.useCallback(() => {
        speak(annotation.target, targetLang);
    }, [annotation.target, targetLang]);

    const details = [annotation.ipa, annotation.pos].filter((value) => typeof value === 'string' && value.length > 0).join(' · ');
    const meaning = typeof annotation.meaning === 'string' && annotation.meaning.length > 0 && annotation.meaning !== annotation.source ?
        annotation.meaning
        :
        null;

    return (
        <div
            ref={cardRef}
            className={classnames(className, styles['word-card'], { [styles['below']]: position?.below })}
            style={position !== null ? { left: position.left, top: position.top } : { visibility: 'hidden' }}
            onMouseDown={stopPropagation}
            onClick={stopPropagation}
            onDoubleClick={stopPropagation}
            onTouchStart={stopPropagation}
            onWheel={stopPropagation}>
            <div className={styles['target']}>
                <span className={styles['target-label']}>{annotation.target}</span>
                {
                    speechAvailable ?
                        <Button className={styles['speak-button']} title={STRINGS.LISTEN} tabIndex={-1} onClick={onSpeakClick}>
                            ▶
                        </Button>
                        :
                        null
                }
            </div>
            {
                details.length > 0 ?
                    <div className={styles['details']}>{details}</div>
                    :
                    null
            }
            <div className={styles['source']}>
                {STRINGS.IN_LANGUAGE(card.sourceLang)} <b>{annotation.source}</b>
            </div>
            {
                meaning !== null ?
                    <div className={styles['meaning']}>{meaning}</div>
                    :
                    null
            }
            {
                typeof annotation.example === 'string' && annotation.example.length > 0 ?
                    <div className={styles['example']}>“{annotation.example}”</div>
                    :
                    null
            }
            <div className={styles['actions']}>
                {
                    bankWord ?
                        <div className={styles['bank']}>
                            <span className={styles['bank-badge']}>{STRINGS.IN_BANK}</span>
                            <span className={styles['bank-next']}>
                                {bankWord.paused ? STRINGS.PAUSED_IN_REVIEW : STRINGS.NEXT_REVIEW(formatNextReview(bankWord.dueAt))}
                            </span>
                        </div>
                        :
                        <Button className={classnames(styles['action'], styles['primary'], { [styles['saved']]: saved })} tabIndex={-1} onClick={onSave}>
                            {saved ? (pending ? STRINGS.SAVED_PENDING : STRINGS.SAVED) : STRINGS.SAVE_WORD}
                        </Button>
                }
                <Button className={styles['action']} tabIndex={-1} onClick={onClose}>
                    {STRINGS.CONTINUE}
                </Button>
            </div>
            <div className={styles['arrow']} style={position !== null ? { left: position.arrow } : null} />
        </div>
    );
};

WordCard.propTypes = {
    className: PropTypes.string,
    card: PropTypes.shape({
        annotation: PropTypes.object.isRequired,
        cueText: PropTypes.string,
        rect: PropTypes.object,
        anchor: PropTypes.object,
        targetLang: PropTypes.string,
        sourceLang: PropTypes.string,
        saved: PropTypes.bool,
        pending: PropTypes.bool,
        bankWord: PropTypes.shape({
            dueAt: PropTypes.string,
            paused: PropTypes.bool,
        }),
    }).isRequired,
    containerRef: PropTypes.object.isRequired,
    cardRef: PropTypes.object.isRequired,
    onSave: PropTypes.func,
    onClose: PropTypes.func,
};

module.exports = WordCard;
