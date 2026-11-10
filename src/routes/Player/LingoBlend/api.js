// LingoBlend: access to the `lingoBlend` API exported by the linked @stremio/stremio-video fork.
// Guarded so the player keeps working if the fork does not export it (yet).

let lingoBlend = null;
try {
    const exported = require('@stremio/stremio-video').lingoBlend;
    if (exported && typeof exported.setProvider === 'function') {
        lingoBlend = exported;
    } else {
        console.warn('LingoBlend: @stremio/stremio-video does not export lingoBlend');
    }
} catch (error) {
    console.warn('LingoBlend: unable to load @stremio/stremio-video', error);
}

module.exports = lingoBlend;
