import Module from './index';
import { Context, RunAt } from '../context';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { session } from 'electron';
import { waitFor } from '../util';

type OnBeforeRequestFunction = (
    details: Electron.OnBeforeRequestListenerDetails,
    callback: (response: Electron.Response) => void
) => any;

export default class Manager {
    loaded: Module[] = [];
    private static beforeRequestCallbacks: OnBeforeRequestFunction[] = [];

    private directory = join(__dirname, '../modules/');
    private context: Context;
    private settingsInjected = false;

    private cached: Module[] = [];

    constructor(context: Context) {
        this.context = context;
    }

    listAll(dir = this.directory): Module[] {

        for (let file of readdirSync(dir)) {
            let path = dir + file;
            let stat = statSync(path);

            if (stat.isDirectory()) this.cached.push(...this.listAll(path + '/'));
            else {
                try {
                    let ModuleClass = require(path).default;

                    let index = this.cached.findIndex(x => x instanceof ModuleClass);
                    if (index >= 0) continue;
                    
                    let module = new ModuleClass();
                    if (module instanceof Module) this.cached.push(module);
                } catch {}
            }
        }

        return this.cached;
    }

    load(runAt: RunAt) {
        void this.injectSettings().catch((error) => {
            console.error('Error while injecting settings:', error);
        });

        let modules = this.listAll();
        for (let module of modules) {
            if (
                module.contexts.findIndex(
                    (ctx) => ctx.context == this.context && ctx.runAt == runAt
                ) == -1
            )
                continue;

            module.manager = this;

            try {
                module.init?.(this.context);
            } catch (initError) {
                console.error(
                    `Error while initializing module ${module.name}:`,
                    initError
                );
                return;
            }

            try {
                if (
                    this.context == Context.Startup ||
                    this.context == Context.Common
                )
                    module.main?.();
                else {
                    module.renderer?.(this.context);
                }
            } catch (moduleError) {
                console.error(
                    `Error while running module ${module.name}:`,
                    moduleError
                );
                return;
            }

            this.loaded.push(module);
        }
    }

    private async injectSettings() {
        if (
            this.settingsInjected ||
            this.context == Context.Startup ||
            this.context == Context.Common
        )
            return;
        this.settingsInjected = true;

        let settings: any = await waitFor(
            () =>
                window.windows?.[0] &&
                window.windows[0].getSettings &&
                window.windows[0]
        );

        if (!Array.isArray(settings.tabs)) return;

        let clientTabIndex = settings.tabs.findIndex((tab) => tab?.name == 'Client');
        if (clientTabIndex === -1) {
            clientTabIndex = settings.tabs.length;
            settings.tabs.push({
                name: 'Client',
                categories: [],
            });
        }

        let getCSettings = typeof settings.getCSettings == 'function'
            ? settings.getCSettings
            : () => '';
        let manager = this;

        settings.getCSettings = function (...args) {
            let html = getCSettings.apply(this, args) || '';
            let search = this.settingSearch?.toLowerCase() ?? '';

            if (this.tabIndex !== clientTabIndex && (!search || !manager.hasClientSettings(search))) return html;

            setTimeout(() => manager.generateSettings(this));
            return html + '<div id="raysClientSettings"></div>';
        };
    }

    private hasClientSettings(search: string) {
        if (!search) return true;

        return this.listAll().some((module) =>
            module.options.length &&
            (module.name.toLowerCase().includes(search) ||
                module.options.some((option) =>
                    option.name.toLowerCase().includes(search)
                ))
        );
    }

    private generateSettings(settings: any) {
        let { settingSearch: search } = settings;
        search = search?.toLowerCase() ?? '';

        let tabName = settings.tabs[settings.tabIndex]?.name;
        let isClientTab = tabName == 'Client';

        let holder = document.getElementById('raysClientSettings');
        if (!holder) return;
        holder.innerHTML = '';

        if (isClientTab) this.generateSettingsKey(holder);

        for (let module of this.listAll()) {
            let moduleInSearch = module.name.toLowerCase().includes(search);
            let genModule =
                (isClientTab ||
                    (search &&
                        (moduleInSearch ||
                            module.options.some((option) =>
                                option.name.toLowerCase().includes(search)
                            )))) &&
                module.options.length;

            if (genModule) {
                let container = document.createElement('div');
                container.classList.add('setBodH');

                let header = document.createElement('div');
                header.classList.add('setHed');
                header.onclick = () => {
                    let isOpen = container.style.display !== 'none';

                    if (isOpen) {
                        header.children[0].textContent = 'keyboard_arrow_right';
                        container.style.display = 'none';
                    } else {
                        header.children[0].textContent = 'keyboard_arrow_down';
                        container.style.display = '';
                    }
                };

                header.textContent = module.name;
                header.insertAdjacentHTML(
                    'afterbegin',
                    '<span class="material-icons plusOrMinus">keyboard_arrow_down</span>'
                );
                holder.append(header, container);

                for (let option of module.options) {
                    let genOption =
                        isClientTab ||
                        (search &&
                            (moduleInSearch ||
                                option.name.toLowerCase().includes(search)));
                    if (genOption) container.appendChild(option.generate());
                }
            }
        }
    }

    private generateSettingsKey(holder: HTMLElement) {
        let header = document.createElement('div');
        header.classList.add('setHed');
        header.textContent = 'Key';

        let container = document.createElement('div');
        container.classList.add('setBodH', 'raysSettingsKey');

        for (let i = 0; i < 2; i++) {
            let setting = document.createElement('div');
            setting.classList.add('settName');

            let star = document.createElement('span');
            star.classList.add('raysSettingsKeyStar');
            star.textContent = '*';
            star.style.color = i == 0 ? 'aqua' : 'red';

            let text = document.createElement('span');
            text.textContent = i == 0 ? ' Requires refresh' : ' Requires restart';

            setting.append(star, text);
            container.appendChild(setting);
        }

        holder.append(header, container);
    }

    static registerBeforeRequestCallback(callback: OnBeforeRequestFunction) {
        if (!Manager.beforeRequestCallbacks.includes(callback))
            Manager.beforeRequestCallbacks.push(callback);
    }

    static unregisterBeforeRequestCallback(callback: OnBeforeRequestFunction) {
        let index = Manager.beforeRequestCallbacks.indexOf(callback);
        if (index !== -1) Manager.beforeRequestCallbacks.splice(index, 1);
    }

    static async onBeforeRequest(
        details: Electron.OnBeforeRequestListenerDetails,
        finalCallback: (response: Electron.Response) => void
    ) {
        for (let callback of Manager.beforeRequestCallbacks) {
            let response = await new Promise<Electron.Response>((resolve) =>
                callback(details, resolve)
            );

            if (response.cancel || response.redirectURL)
                return finalCallback(response);
        }

        finalCallback({ cancel: false });
    }

    initBeforeRequest() {
        session.defaultSession.webRequest.onBeforeRequest(
            Manager.onBeforeRequest
        );
    }
}
