module.exports = {
    command: ["jadibot", "listjadibot", "ping"],
    run: async (sock, m, { args, command, startBot, config }) => {
        const sender = m.key.remoteJid;

        if (command === "ping") {
            return sock.sendMessage(sender, { text: "Pong! Bot aktif." });
        }

        if (command === "jadibot") {
            let targetNum = args[0] ? args[0].replace(/[^0-9]/g, '') : null;
            if (!targetNum) return sock.sendMessage(sender, { text: `Gunakan format: ${config.prefix}jadibot 628xxx` });

            await sock.sendMessage(sender, { text: "Memproses... Mohon tunggu kode pairing muncul." });

            // Start Clone
            await startBot(`./sessions/clone_${targetNum}`, true, targetNum);

            // Kirim kode pairing ke chat user
            let checkCode = setInterval(async () => {
                if (global.pairingCode) {
                    await sock.sendMessage(sender, { 
                        text: `KODE PAIRING ANDA:\n\n*${global.pairingCode}*\n\nMasukkan kode ini di WhatsApp -> Tautkan Perangkat.` 
                    });
                    clearInterval(checkCode);
                    delete global.pairingCode;
                }
            }, 2000);
        }

        if (command === "listjadibot") {
            if (global.cloneBots.length === 0) return sock.sendMessage(sender, { text: "Belum ada bot clone yang aktif." });
            let txt = "*DAFTAR CLONE BOT AKTIF:*\n\n";
            global.cloneBots.forEach((v, i) => {
                txt += `${i + 1}. @${v}\n`;
            });
            await sock.sendMessage(sender, { text: txt, mentions: global.cloneBots.map(v => v + "@s.whatsapp.net") });
        }
    }
};
