const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs-extra");
const path = require("path");
const config = require("./settings");

// --- Inisialisasi Database ---
if (!fs.existsSync(config.dbPath)) fs.writeJsonSync(config.dbPath, { users: {} });
if (!fs.existsSync(config.cloneDbPath)) fs.writeJsonSync(config.cloneDbPath, []);

global.db = fs.readJsonSync(config.dbPath);
global.cloneBots = fs.readJsonSync(config.cloneDbPath);
global.conns = {}; // Menyimpan koneksi aktif

// Auto Save DB
setInterval(() => {
    fs.writeJsonSync(config.dbPath, global.db);
    fs.writeJsonSync(config.cloneDbPath, global.cloneBots);
}, 5000);

// --- Fungsi Utama Bot ---
async function startBot(authFolder = 'sessions/main', isClone = false, targetNumber = null) {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    // Request Pairing Code jika belum login
    if (!sock.authState.creds.registered) {
        const phoneNumber = isClone ? targetNumber : config.botNumber;
        if (!phoneNumber) return console.log("Nomor tidak ditemukan untuk pairing!");

        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n[ ${isClone ? 'CLONE' : 'MAIN'} ] KODE PAIRING (${phoneNumber}): ${code}\n`);
                global.pairingCode = code; // Simpan sementara untuk dikirim ke chat
            } catch (e) {
                console.error("Gagal request pairing code:", e);
            }
        }, 3000);
    }

    // --- Plugin Loader ---
    const plugins = {};
    const pluginsFolder = path.join(__dirname, "plugins");
    if (!fs.existsSync(pluginsFolder)) fs.mkdirSync(pluginsFolder);

    const loadPlugins = () => {
        fs.readdirSync(pluginsFolder).forEach(file => {
            if (file.endsWith(".js")) {
                const pluginPath = path.join(pluginsFolder, file);
                delete require.cache[require.resolve(pluginPath)]; // Clear cache untuk hot-reload
                plugins[file] = require(pluginPath);
            }
        });
    };
    loadPlugins();

    // --- Message Handler ---
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const remoteJid = m.key.remoteJid;
        const body = m.message.conversation || m.message.extendedTextMessage?.text || "";
        const isCmd = body.startsWith(config.prefix);
        const command = isCmd ? body.slice(config.prefix.length).trim().split(" ")[0].toLowerCase() : "";
        const args = body.trim().split(" ").slice(1);

        // Database User Check
        if (!global.db.users[remoteJid]) global.db.users[remoteJid] = { hit: 0 };

        // Jalankan Plugin
        for (const name in plugins) {
            const plugin = plugins[name];
            if (plugin.command && plugin.command.includes(command)) {
                try {
                    await plugin.run(sock, m, { args, body, command, startBot, config });
                } catch (err) {
                    console.error(`Error di plugin ${name}:`, err);
                    sock.sendMessage(remoteJid, { text: "Terjadi kesalahan saat menjalankan perintah." });
                }
            }
        }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "open") {
            console.log(`[ CONNECTED ] ${isClone ? 'Clone ' + targetNumber : 'Bot Utama'}`);
            if (isClone && !global.cloneBots.includes(targetNumber)) {
                global.cloneBots.push(targetNumber);
            }
        }
        if (connection === "close") {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                startBot(authFolder, isClone, targetNumber);
            } else {
                console.log(`[ LOGGED OUT ] Koneksi ${targetNumber || 'Utama'} berakhir.`);
                if (isClone) {
                    global.cloneBots = global.cloneBots.filter(n => n !== targetNumber);
                    fs.removeSync(authFolder);
                }
            }
        }
    });

    if (isClone) global.conns[targetNumber] = sock;
    return sock;
}

// Jalankan Bot Utama
startBot().catch(err => console.error("Main Bot Error:", err));
