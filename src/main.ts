import { screen, app, BrowserWindow, shell, ipcMain } from 'electron';
import { launch, launchKey } from './index';
import config from './config';
import { Context, RunAt, fromURL } from './context';
import ModuleManger from './module/manager';
import { join } from 'path';
import process from 'process';

export let window: BrowserWindow;
let promptWindow: BrowserWindow | null = null;
const userAgent = 'Electron';

function getWindowBoundsForDisplay(display: Electron.Display, width: number, height: number) {
    const { x, y, width: displayWidth, height: displayHeight } = display.workArea;
    return {
        x: Math.max(x, x + Math.floor((displayWidth - width) / 2)),
        y: Math.max(y, y + Math.floor((displayHeight - height) / 2)),
    };
}

function initPromptWindow() {
    let response: unknown = null;

    ipcMain.on('prompt', (event, opt) => {
        response = null;

        const ownerWindow = BrowserWindow.getFocusedWindow() || window;
        const ownerDisplay = ownerWindow && !ownerWindow.isDestroyed()
            ? screen.getDisplayMatching(ownerWindow.getBounds())
            : screen.getPrimaryDisplay();
        const promptWidth = 300;
        const promptHeight = 157;
        const promptBounds = getWindowBoundsForDisplay(
            ownerDisplay,
            promptWidth,
            promptHeight
        );

        promptWindow = new BrowserWindow({
            width: promptWidth,
            height: promptHeight,
            x: promptBounds.x,
            y: promptBounds.y,
            show: false,
            frame: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            resizable: false,
            movable: false,
            transparent: true,
            parent: ownerWindow && !ownerWindow.isDestroyed() ? ownerWindow : undefined,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true,
            },
        });

        promptWindow.loadFile(join(__dirname, '../assets/html/prompt.html'));

        promptWindow.webContents.on('did-finish-load', () => {
            promptWindow?.show();
            promptWindow?.webContents.send('text', JSON.stringify(opt));
        });

        promptWindow.on('closed', () => {
            event.returnValue = response;
            promptWindow = null;
        });
    });

    ipcMain.on('prompt-response', (_event, args) => {
        response = args === '' ? null : args;
    });
}

initPromptWindow();

function quit() {
    let size = window.getSize();
    let pos = window.getPosition();
    let fullscreen = window.isFullScreen();

    config.set('window', {
        width: size[0],
        height: size[1],
        x: pos[0],
        y: pos[1],
        fullscreen,
    });

    let launchMode = config.get('modules.launcher.mode', 0);
    if (launchMode == 1) {
        app.removeAllListeners('window-all-closed');
        app.on('window-all-closed', (event) => event.preventDefault());

        launch(launchKey, launchMode);
        return;
    }

    app.quit();
}

async function handleKeyEvent(
    context: Context,
    window: BrowserWindow,
    event: Electron.Event,
    input: Electron.Input
) {
    if (input.type !== 'keyDown') return;

    let binds = config.get('keybinds', {
        newGame: 'F6',
        refresh: 'F5',
        fullscreen: 'F11',
        devtools: 'F12',
        logout: 'F7',
    });

    binds.newGame = binds.newGame || 'F6';
    binds.refresh = binds.refresh || 'F5';
    binds.fullscreen = binds.fullscreen || 'F11';
    binds.devtools = binds.devtools || 'F12';
    binds.logout = binds.logout || 'F7';

    switch (context) {
        case Context.Game:
            if (input.key == binds.newGame)
                window.loadURL('https://totallynotio.krunker.zip', { userAgent });
        default:
            if (input.key == binds.refresh) window.reload();

            if (input.key == binds.fullscreen)
                window.setFullScreen(!window.isFullScreen());

            if (input.key == binds.devtools) {
                let devtools = window.webContents.isDevToolsOpened();

                if (devtools) window.webContents.closeDevTools();
                else window.webContents.openDevTools({ mode: 'detach' });
            }

            if (input.key === binds.logout) window.webContents.send('logout');

            break;
    }
}

export default function createMainWindow(key: string) {
    if (key !== launchKey) process.exit(1337);
    let { workAreaSize: displaySize } = screen.getPrimaryDisplay();

    let windowParams = config.get('window', {
        width: displaySize.width,
        height: displaySize.height,
        x: 0,
        y: 0,
        fullscreen: false,
    });

    windowParams.width = windowParams.width || displaySize.width;
    windowParams.height = windowParams.height || displaySize.height;
    windowParams.x = windowParams.x || 0;
    windowParams.y = windowParams.y || 0;
    windowParams.fullscreen = windowParams.fullscreen || false;

    window = new BrowserWindow({
        ...windowParams,
        title: app.getName(),
        show: false,
        icon: 'assets/img/icon.png',

        webPreferences: {
            preload: join(__dirname, 'preload/index.js'),
            sandbox: false,
            contextIsolation: false,
        },
    });

    let moduleManager = new ModuleManger(Context.Common);
    moduleManager.load(RunAt.LoadStart);

    window.setMenu(null);
    window.on('close', quit);

    window.webContents.on(
        'did-fail-load',
        (event, errorCode, errorDesc, validatedURL, isMainFrame) => {
            if (isMainFrame) window.loadFile('assets/html/disconnected.html');
        }
    );

    window.once('ready-to-show', () => {
        window.show();
        moduleManager.load(RunAt.LoadEnd);
    });

    window.webContents.on('page-title-updated', (event) => {
        event.preventDefault();
        window.setTitle(app.getName());
    });
    window.webContents.on('will-navigate', (event, url) => {
        event.preventDefault();
        handleNavigation(new URL(url));
    });
    window.webContents.on('new-window', (event, url) => {
        event.preventDefault();
        handleNavigation(new URL(url));
    });
    window.webContents.on(
        'before-input-event',
        handleKeyEvent.bind(null, Context.Game, window)
    );
    window.loadURL(process.argv.includes('--sandbox')
        ? 'https://totallynotio.krunker.zip/?sandbox'
        : (process.argv.find(e => e.startsWith('https://totallynotio.krunker.zip')) || 'https://totallynotio.krunker.zip'),
        { userAgent }
    );
}

export function handleNavigation(url: URL) {
    let context = fromURL(url);

    switch (context) {
        case Context.Game:
            window.loadURL(url.toString());
            break;
        case null:
            shell.openExternal(url.toString());
            break;
        default:
            let win = new BrowserWindow({
                width: 800,
                height: 600,
                title: app.getName(),
                icon: 'assets/img/icon.png',
                webPreferences: {
                    preload: join(__dirname, 'preload/index.js'),
                    sandbox: false,
                    contextIsolation: false,
                },
            });

            win.setMenu(null);
            win.webContents.on('will-navigate', (event, url) => {
                event.preventDefault();
                handleNavigation(new URL(url));
            });
            win.webContents.on('new-window', (event, url) => {
                event.preventDefault();
                handleNavigation(new URL(url));
            });
            win.webContents.on(
                'before-input-event',
                handleKeyEvent.bind(null, context, win)
            );
            win.webContents.on('will-prevent-unload', (event) =>
                event.preventDefault()
            );
            win.webContents.on('page-title-updated', (event, title) => {
                event.preventDefault();
                win.setTitle(app.getName() + ' - ' + title);
            });

            win.loadURL(url.toString(), { userAgent });
            break;
    }
}
