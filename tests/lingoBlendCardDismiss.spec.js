// LingoBlend: dismissing the word card (src/routes/Player/LingoBlend/cardDismiss.js).

const { listenCardDismiss } = require('../src/routes/Player/LingoBlend/cardDismiss');

// node's Event has no DOM tree: give each event the target it would have in the browser.
class TargetedEvent extends Event {
    constructor(type, target, init = {}) {
        super(type, { cancelable: true, ...init });
        this.fakeTarget = target;
    }
    get target() {
        return this.fakeTarget;
    }
}

const setup = () => {
    const win = new EventTarget();
    const doc = new EventTarget();
    const card = { name: 'card' };
    const video = { name: 'video (subtitles live here)' };
    const controlBar = { name: 'control bar' };
    const onClose = jest.fn();
    const dispose = listenCardDismiss({
        win,
        doc,
        isInsideCard: (target) => target === card,
        isInsideVideo: (target) => target === video,
        onClose,
    });
    // Like a real gesture: mousedown goes through window (capture) and document, then the click.
    const press = (target) => {
        win.dispatchEvent(new TargetedEvent('mousedown', target));
        doc.dispatchEvent(new TargetedEvent('mousedown', target));
    };
    const click = (target) => {
        const event = new TargetedEvent('click', target);
        win.dispatchEvent(event);
        return event;
    };
    return { win, doc, card, video, controlBar, onClose, dispose, press, click };
};

describe('LingoBlend card dismiss', () => {
    it('does not close on a mousedown inside the card', () => {
        const { card, onClose, press } = setup();
        press(card);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes on Escape and keeps it away from the player shortcuts', () => {
        const { win, onClose } = setup();
        const event = new TargetedEvent('keydown', null);
        Object.defineProperty(event, 'key', { value: 'Escape' });
        win.dispatchEvent(event);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    // The menus' click-catcher layer is not shown for the card (it covered the subtitle words, so clicking
    // another word closed the card and resumed the video). A click on the bare video must then only close
    // the card: without this, the player's onVideoClick toggled playback right after closeCard.
    it('swallows the click that follows a mousedown on the video, even after the listeners are disposed', () => {
        const { video, onClose, dispose, press, click } = setup();
        press(video);
        expect(onClose).toHaveBeenCalledTimes(1);
        dispose(); // React removes the listeners as soon as the card closes, before the click arrives

        const swallowed = click(video);
        expect(swallowed.defaultPrevented).toBe(true);
        expect(swallowed.cancelBubble).toBe(true);

        const next = click(video);
        expect(next.defaultPrevented).toBe(false);
    });

    it('does not swallow clicks outside of the video (control bar keeps working)', () => {
        const { controlBar, onClose, press, click } = setup();
        press(controlBar);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(click(controlBar).defaultPrevented).toBe(false);
    });

    it('forgets the pending swallow when the gesture ends without a click', () => {
        const { win, video, dispose, press, click } = setup();
        press(video);
        dispose();
        // mouseup elsewhere: no click. The next gesture starts with a new mousedown.
        win.dispatchEvent(new TargetedEvent('mousedown', video));
        expect(click(video).defaultPrevented).toBe(false);
    });
});
