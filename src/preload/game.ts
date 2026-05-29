import { Context } from '../context';
import Preload from './preload';
import { readFileSync } from 'fs';
import '../types/window';
import { join } from 'path';
import { branch, commit } from '../../buildinfo.json';
import { waitFor } from '../util';
import { ipcRenderer } from 'electron';

ipcRenderer.on('logout', () => {
    // if (!prompt('You pressed F7, are you sure you want to log out? This will clear all local data and cookies.')) return;
    console.log('logging out of the game.');
    const storageKeys = [ 'krunker_last', 'krunker_id', 'krunker_token', 'conUID_', '__frvr_rfc_uuidv4', '__FRVR_auth_refresh_token', '__FRVR_auth_access_token', 'pageSessionId', 'playSessionId', 'playSessionIdTimeStamp', 'registerNotificationLastShown' ];
    const cookies = [ '__FRVR_auth_refresh_token', '__FRVR_auth_access_token', '_frvr' ];
    for (const key of storageKeys) localStorage.removeItem(key);
    const domains = [ 'totallynotio.krunker.zip', '.totallynotio.krunker.zip' ];
    for (const cookie of cookies) {
        for (const domain of domains) {
            document.cookie = `${cookie}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${domain}`;
        }
    }
    location.reload();
});

export default class GamePreload extends Preload {
    context = Context.Game;

    onLoadStart() {
        window.OffCliV = true;
        localStorage.removeItem('conUID_'); // anti tracking
    }

    onLoadEnd() {
        if (window.clientExit) window.clientExit.style.display = 'flex';
        window.closeClient = () => window.close();

        let style = document.createElement('style');
        style.textContent = readFileSync(
            join(__dirname, '../../assets/style/game.css'),
            'utf8'
        );
        document.head.append(style);

        injectWatermark();
        injectHSP();
    }
}

function injectWatermark() {
    let watermark = document.createElement('div');
    watermark.dataset.text = '[Rays] Nova';
    watermark.dataset.version = `${branch}/${commit}`;
    watermark.id = 'clientWatermark';

    const matchInfo = document.getElementById('matchInfo');
    matchInfo?.insertAdjacentElement('beforebegin', watermark);

    const timeHolder = document.getElementById('timeHolder');
    if (timeHolder) timeHolder.style.cssText += ';width:fit-content!important';
}

async function injectHSP() {
    await waitFor(() => window.windows?.[4] && window.windows[4].gen);

    const ogen = window.windows[4].gen;
    window.windows[4].gen = function () {
        setTimeout(() => {
            let statHolder = document.getElementById('statHolder');
            if (!statHolder) return;

            let stats = statHolder.children[2].children;

            let hits = -1;
            let headshots = -1;
            let accuracyInd = -1;

            for (let i = 0; i < stats.length; i++) {
                let stat = stats[i];
                let statName = stat.childNodes[0].textContent;

                if (statName == 'Hits') {
                    hits = Number(stat.childNodes[1]?.textContent?.replaceAll(',', '') ?? '0');
                } else if (statName == 'Headshots') {
                    headshots = Number(stat.childNodes[1]?.textContent?.replaceAll(',', '') ?? '0');
                } else if (statName == 'Accuracy') {
                    accuracyInd = i;
                }
            }

            if (hits == -1 || headshots == -1 || accuracyInd == -1) return;

            let hsp = stats[0].cloneNode(true);
            hsp.childNodes[0].textContent = 'HS%';
            hsp.childNodes[1].textContent = (headshots / hits * 100).toFixed(2) + '%';

            statHolder.children[2].insertBefore(hsp, stats[accuracyInd + 1]);
        });
        return ogen.apply(this, arguments);
    };
}