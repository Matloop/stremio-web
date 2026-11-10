// LingoBlend: how the open word card is dismissed by the user (Escape or a mousedown outside of it).
// Plain DOM listeners, no React, so it can be tested with node's EventTarget.
//
// The player's menus use a transparent full-size "click-catcher" layer, but the card must not: it would
// cover the subtitles, so clicking another word hit the layer, closed the card and resumed the video.
// Without the layer, a click on the bare video would also reach the player's onVideoClick and toggle
// playback right after the card closed (resume, then pause again). The mousedown that closes the card
// therefore swallows the click of the same gesture, which is what the layer used to do.

// Object form: node's EventTarget (tests) ignores a boolean `true` in removeEventListener.
const CAPTURE = { capture: true };

const isEscape = (event) => event.key === 'Escape' || event.code === 'Escape';

// Stops the next click (capture phase on `win`, before React's root listener). Outlives the card's
// listeners on purpose: React removes them as soon as the card closes, before the click arrives.
// A new mousedown means the previous gesture ended without a click: forget it.
const swallowNextClick = (win) => {
    const onClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        cleanup();
    };
    const cleanup = () => {
        win.removeEventListener('click', onClick, CAPTURE);
        win.removeEventListener('mousedown', cleanup, CAPTURE);
    };
    win.addEventListener('click', onClick, CAPTURE);
    // Added while the current mousedown is past the window's capture phase, so it only fires for the next one.
    win.addEventListener('mousedown', cleanup, CAPTURE);
};

// win / doc: the window and document to listen on.
// isInsideCard(target): true for nodes inside the card (clicks there never dismiss it).
// isInsideVideo(target): true for nodes inside the video container (where the subtitles are).
// onClose(): closes the card (and resumes the video if the card paused it).
// Subtitle words stop mousedown propagation themselves, so clicking another word never gets here.
// Returns a function that removes the listeners.
const listenCardDismiss = ({ win, doc, isInsideCard, isInsideVideo, onClose }) => {
    const onKeyDown = (event) => {
        if (!isEscape(event)) return;
        // Escape must not reach the player's exit shortcut.
        event.preventDefault();
        event.stopPropagation();
        onClose();
    };
    const onMouseDown = (event) => {
        if (isInsideCard(event.target)) return;
        if (isInsideVideo(event.target)) {
            swallowNextClick(win);
        }
        onClose();
    };

    win.addEventListener('keydown', onKeyDown, CAPTURE);
    doc.addEventListener('mousedown', onMouseDown);
    return () => {
        win.removeEventListener('keydown', onKeyDown, CAPTURE);
        doc.removeEventListener('mousedown', onMouseDown);
    };
};

module.exports = { listenCardDismiss };
