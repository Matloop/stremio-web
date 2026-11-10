// LingoBlend: settings menu opened from the "IT" control bar button (design/mockup.html `.menu`).

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { default: Button } = require('stremio/components/Button');
const { default: Toggle } = require('stremio/components/Toggle');
const Slider = require('stremio/components/Slider');
const { TARGET_LANGUAGES, DENSITY_MIN, DENSITY_MAX } = require('../storage');
const STRINGS = require('../strings');
const styles = require('./styles');

const LingoBlendMenu = React.forwardRef(({ className, available, settings, status, statusLabel, savedCount, onSettingsChanged, onExportCSV }, ref) => {
    const [density, setDensity] = React.useState(settings.density);
    const [serverUrl, setServerUrl] = React.useState(settings.serverUrl);
    React.useEffect(() => setDensity(settings.density), [settings.density]);
    React.useEffect(() => setServerUrl(settings.serverUrl), [settings.serverUrl]);

    const onMouseDown = React.useCallback((event) => {
        event.nativeEvent.lingoBlendMenuClosePrevented = true;
    }, []);
    const changeSettings = React.useCallback((partial) => {
        if (typeof onSettingsChanged === 'function') {
            onSettingsChanged(partial);
        }
    }, [onSettingsChanged]);
    const onEnabledClick = React.useCallback(() => {
        changeSettings({ enabled: !settings.enabled });
    }, [settings.enabled, changeSettings]);
    const onPauseOnClickClick = React.useCallback(() => {
        changeSettings({ pauseOnClick: !settings.pauseOnClick });
    }, [settings.pauseOnClick, changeSettings]);
    const onTargetLangChange = React.useCallback((event) => {
        changeSettings({ targetLang: event.target.value });
    }, [changeSettings]);
    const onDensitySlide = React.useCallback((value) => {
        setDensity(Math.round(value));
    }, []);
    const onDensityComplete = React.useCallback((value) => {
        const next = Math.round(value);
        setDensity(next);
        changeSettings({ density: next });
    }, [changeSettings]);
    const commitServerUrl = React.useCallback(() => {
        const next = serverUrl.trim();
        if (next.length > 0 && next !== settings.serverUrl) {
            changeSettings({ serverUrl: next });
        } else {
            setServerUrl(settings.serverUrl);
        }
    }, [serverUrl, settings.serverUrl, changeSettings]);
    const onServerUrlChange = React.useCallback((event) => {
        setServerUrl(event.target.value);
    }, []);
    const onServerUrlKeyDown = React.useCallback((event) => {
        if (event.key === 'Enter') {
            event.currentTarget.blur();
        }
    }, []);

    return (
        <div ref={ref} className={classnames(className, styles['lingoblend-menu-container'])} onMouseDown={onMouseDown}>
            <div className={styles['title']}>{STRINGS.TITLE}</div>
            <div className={styles['fields']}>
                <div className={styles['field']}>
                    <span className={styles['label']}>{STRINGS.ENABLED}</span>
                    <Toggle className={styles['toggle']} checked={settings.enabled} tabIndex={-1} onClick={onEnabledClick} />
                </div>
                <div className={styles['field']}>
                    <span className={styles['label']}>{STRINGS.LEARNING}</span>
                    <select className={styles['input']} value={settings.targetLang} onChange={onTargetLangChange}>
                        {
                            TARGET_LANGUAGES.map(({ code, label }) => (
                                <option key={code} value={code}>{label}</option>
                            ))
                        }
                    </select>
                </div>
                <div className={classnames(styles['field'], styles['density-field'])}>
                    <span className={styles['label']}>{STRINGS.DENSITY}</span>
                    <span className={styles['value']}>{density}%</span>
                </div>
                <Slider
                    className={styles['slider']}
                    value={density}
                    minimumValue={DENSITY_MIN}
                    maximumValue={DENSITY_MAX}
                    stepValue={1}
                    onSlide={onDensitySlide}
                    onComplete={onDensityComplete}
                />
                <div className={styles['field']}>
                    <span className={styles['label']}>{STRINGS.PAUSE_ON_CLICK}</span>
                    <Toggle className={styles['toggle']} checked={settings.pauseOnClick} tabIndex={-1} onClick={onPauseOnClickClick} />
                </div>
                <div className={styles['field']}>
                    <span className={styles['label']}>{STRINGS.SERVER}</span>
                    <input
                        className={classnames(styles['input'], styles['server-input'])}
                        type={'text'}
                        spellCheck={false}
                        value={serverUrl}
                        onChange={onServerUrlChange}
                        onBlur={commitServerUrl}
                        onKeyDown={onServerUrlKeyDown}
                    />
                </div>
            </div>
            <div className={styles['footer']}>
                <div className={classnames(styles['status'], styles[`status-${available ? status.state : 'error'}`])}>
                    <span className={styles['status-dot']} />
                    {statusLabel}
                </div>
                <div className={styles['saved']}>
                    <span>{STRINGS.SAVED_WORDS} <b>{savedCount}</b></span>
                    <Button className={classnames(styles['export-button'], { 'disabled': savedCount === 0 })} tabIndex={-1} onClick={onExportCSV}>
                        {STRINGS.EXPORT_CSV}
                    </Button>
                </div>
            </div>
        </div>
    );
});

LingoBlendMenu.propTypes = {
    className: PropTypes.string,
    available: PropTypes.bool,
    settings: PropTypes.shape({
        enabled: PropTypes.bool,
        targetLang: PropTypes.string,
        density: PropTypes.number,
        pauseOnClick: PropTypes.bool,
        serverUrl: PropTypes.string,
    }).isRequired,
    status: PropTypes.shape({
        state: PropTypes.string,
    }).isRequired,
    statusLabel: PropTypes.string,
    savedCount: PropTypes.number,
    onSettingsChanged: PropTypes.func,
    onExportCSV: PropTypes.func,
};

module.exports = LingoBlendMenu;
