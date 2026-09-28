// =============================================================
// Discord Rich Presence — zero-dependency IPC client
// =============================================================
// Talks to the local Discord client over its named pipe (Windows) or
// unix socket (macOS/Linux) using the documented RPC framing:
//   [ int32LE opcode ][ int32LE payload length ][ utf8 JSON payload ]
// Opcodes: 0 = handshake, 1 = frame, 2 = close, 3 = ping, 4 = pong.
//
// No npm packages required — this keeps the app installable offline and
// avoids the deprecated `discord-rpc` module. If Discord isn't running the
// client just retries quietly in the background; nothing else is affected.

const net = require('net');
const { EventEmitter } = require('events');

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;

function getIpcPath(id) {
    if (process.platform === 'win32') {
        return `\\\\?\\pipe\\discord-ipc-${id}`;
    }
    const base = process.env.XDG_RUNTIME_DIR
        || process.env.TMPDIR
        || process.env.TMP
        || process.env.TEMP
        || '/tmp';
    const prefix = base.replace(/\/$/, '');
    // Newer Discord builds nest the socket under app subfolders.
    return `${prefix}/discord-ipc-${id}`;
}

class DiscordPresence extends EventEmitter {
    constructor(clientId) {
        super();
        this.clientId = clientId ? String(clientId) : '';
        this.socket = null;
        this.connected = false;      // handshake acknowledged (READY received)
        this.destroyed = false;
        this.readBuffer = Buffer.alloc(0);
        this.currentActivity = null; // last activity we were asked to show
        this.reconnectTimer = null;
        this.reconnectDelay = 5000;
        // If Discord rejects our art asset (none uploaded named "logo" in the
        // dev portal), stop sending image keys so the text still shows.
        this.assetsRejected = false;
        this.debug = process.env.FARMER_PLANNER_DISCORD_DEBUG === '1';
    }

    _log(...args) {
        // Always surface errors; chatter only with the debug flag.
        console.log('[discord-rpc]', ...args);
    }

    // Kick off connection attempts. Safe to call once at startup; it will keep
    // retrying until Discord shows up (or destroy() is called).
    connect() {
        if (this.destroyed) return;
        if (!this.clientId || this.clientId === '0' || this.clientId === 'YOUR_DISCORD_APP_ID') {
            this._log('disabled — no Discord application id set in main.js');
            return;
        }
        this._log(`connecting (client_id ${this.clientId})…`);
        this._tryConnect(0);
    }

    _tryConnect(id) {
        if (this.destroyed || this.connected || this.socket) return;
        if (id > 9) {
            // Exhausted ipc-0..9 — Discord probably isn't running. Retry later.
            this._log('no Discord client found (is the desktop app running?) — retrying in 5s');
            this._scheduleReconnect();
            return;
        }

        const sock = net.createConnection(getIpcPath(id));
        this.socket = sock;

        sock.on('connect', () => {
            if (this.debug) this._log(`pipe discord-ipc-${id} open — sending handshake`);
            this._write(OP_HANDSHAKE, { v: 1, client_id: this.clientId });
        });

        sock.on('data', (chunk) => this._onData(chunk));

        sock.on('error', (err) => {
            // This pipe id didn't work — clean up and try the next one.
            if (this.debug) this._log(`pipe discord-ipc-${id}: ${err.code || err.message}`);
            this._cleanupSocket();
            this._tryConnect(id + 1);
        });

        sock.on('close', () => {
            const wasConnected = this.connected;
            this._cleanupSocket();
            if (wasConnected && !this.destroyed) {
                // Discord went away after a good connection — reconnect from scratch.
                this._scheduleReconnect();
            }
        });
    }

    _cleanupSocket() {
        this.connected = false;
        this.readBuffer = Buffer.alloc(0);
        if (this.socket) {
            this.socket.removeAllListeners();
            try { this.socket.destroy(); } catch (_) { /* noop */ }
            this.socket = null;
        }
    }

    _scheduleReconnect() {
        if (this.destroyed || this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this._tryConnect(0);
        }, this.reconnectDelay);
    }

    _onData(chunk) {
        this.readBuffer = Buffer.concat([this.readBuffer, chunk]);

        while (this.readBuffer.length >= 8) {
            const op = this.readBuffer.readInt32LE(0);
            const len = this.readBuffer.readInt32LE(4);
            if (this.readBuffer.length < 8 + len) break;

            const payloadRaw = this.readBuffer.slice(8, 8 + len).toString('utf8');
            this.readBuffer = this.readBuffer.slice(8 + len);

            let payload = null;
            try { payload = JSON.parse(payloadRaw); } catch (_) { payload = null; }

            if (op === OP_CLOSE) {
                const reason = payload && (payload.message || payload.code);
                this._log(`Discord closed the connection${reason ? ': ' + reason : ''}`);
                this._cleanupSocket();
                this._scheduleReconnect();
                return;
            }

            if (op === OP_FRAME && payload) {
                if (payload.evt === 'READY') {
                    const user = payload.data && payload.data.user;
                    this.connected = true;
                    this._log(`connected${user && user.username ? ' as ' + user.username : ''} — pushing activity`);
                    this.emit('connected');
                    // Flush whatever we were last asked to display.
                    this._sendActivity(this.currentActivity);
                } else if (payload.evt === 'ERROR') {
                    const d = payload.data || {};
                    this._log(`Discord rejected a request: [${d.code}] ${d.message}`);
                    // Most common cause: no art asset named like our image key was
                    // uploaded in the Discord dev portal. Drop images and retry
                    // once so the text presence still appears.
                    if (!this.assetsRejected && this.currentActivity &&
                        (this.currentActivity.largeImageKey || this.currentActivity.smallImageKey)) {
                        this.assetsRejected = true;
                        this._log('retrying without image assets');
                        this._sendActivity(this.currentActivity);
                    }
                }
            }
        }
    }

    _write(op, data) {
        if (!this.socket) return false;
        try {
            const json = Buffer.from(JSON.stringify(data), 'utf8');
            const header = Buffer.alloc(8);
            header.writeInt32LE(op, 0);
            header.writeInt32LE(json.length, 4);
            this.socket.write(Buffer.concat([header, json]));
            return true;
        } catch (_) {
            return false;
        }
    }

    // Public: show an activity. `activity` is a plain object:
    //   { details, state, startTimestamp, largeImageKey, largeImageText,
    //     smallImageKey, smallImageText }
    // Pass null / undefined to clear the presence.
    setActivity(activity) {
        this.currentActivity = activity || null;
        if (this.connected) this._sendActivity(this.currentActivity);
    }

    clearActivity() {
        this.setActivity(null);
    }

    _sendActivity(activity) {
        const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        let payloadActivity;
        if (!activity) {
            payloadActivity = undefined; // omitting `activity` clears it
        } else {
            payloadActivity = {
                details: trim(activity.details, 128),
                state: trim(activity.state, 128),
            };
            if (activity.startTimestamp) {
                payloadActivity.timestamps = {
                    start: Math.floor(activity.startTimestamp),
                };
            }
            // Only attach assets if we have any AND Discord hasn't already
            // rejected them (a missing art asset kills the whole payload).
            if (!this.assetsRejected) {
                const assets = {};
                if (activity.largeImageKey) assets.large_image = activity.largeImageKey;
                if (activity.largeImageText) assets.large_text = trim(activity.largeImageText, 128);
                if (activity.smallImageKey) assets.small_image = activity.smallImageKey;
                if (activity.smallImageText) assets.small_text = trim(activity.smallImageText, 128);
                if (Object.keys(assets).length) payloadActivity.assets = assets;
            }
        }

        if (this.debug) this._log('SET_ACTIVITY', JSON.stringify(payloadActivity));
        this._write(OP_FRAME, {
            cmd: 'SET_ACTIVITY',
            args: {
                pid: process.pid,
                activity: payloadActivity,
            },
            nonce,
        });
    }

    destroy() {
        this.destroyed = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this._cleanupSocket();
    }
}

function trim(str, max) {
    if (str === undefined || str === null) return undefined;
    const s = String(str);
    return s.length > max ? s.slice(0, max) : s;
}

module.exports = DiscordPresence;
