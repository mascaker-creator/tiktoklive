const { WebcastPushConnection } = require('tiktok-live-connector');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// --- KONFIGURASI SERVER ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Railway akan memberikan port melalui process.env.PORT
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));

// --- KONFIGURASI GEMINI AI ---
// Ganti API Key di sini jika perlu
const genAI = new GoogleGenerativeAI("AIzaSyCBBNfIQEZpUl_invXs7kDEohRQiy1yZbA");
const modelAI = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const backstory = `Nama kamu Wafabot, penciptamu adalah wafa. 
ATURAN KETAT:
1. Jawab sangat singkat (maksimal 1-2 kalimat).
2. JANGAN PERNAH memberikan kode pemrograman. Jika diminta kode, arahkan belajar ke W3Schools atau MDN.
3. ANTI-XSS & TANPA MARKUP: Berikan teks polos saja, jangan pakai simbol markdown atau script.
4. Bahasa Indonesia santai dan sopan.`;

// --- SISTEM ANTREAN (QUEUE) ---
let chatQueue = [];
let isProcessing = false;

async function askGemini(question) {
    try {
        const prompt = `${backstory}\n\nPertanyaan User: ${question}`;
        const result = await modelAI.generateContent(prompt);
        const response = await result.response;
        
        // Membersihkan output dari karakter Markdown agar teks bersih di OBS
        return response.text()
            .replace(/[*#`_]/g, '') 
            .replace(/<\/?[^>]+(>|$)/g, "")
            .trim();
    } catch (err) {
        console.error("❗ Gemini Error:", err.message);
        return "Wafabot lagi loading otak, tanya lagi nanti ya!";
    }
}

async function processQueue() {
    if (isProcessing || chatQueue.length === 0) return;

    isProcessing = true;
    const current = chatQueue.shift();

    console.log(`[PROCESS] Mengolah chat dari: @${current.user}`);

    let finalAnswer = current.answer || await askGemini(current.msg);

    io.emit('aiResponse', {
        user: current.user,
        question: current.msg,
        answer: finalAnswer
    });

    // Jeda 22 detik agar sinkron dengan durasi tampil di layar (public.ejs)
    setTimeout(() => {
        isProcessing = false;
        processQueue();
    }, 22000);
}

// --- KONEKSI TIKTOK LIVE ---
const tiktokUsername = "wafanyaberkata"; 
let tiktokConn = new WebcastPushConnection(tiktokUsername, {
    processInitialData: true,
    enableWebsocketUpgrade: true,
    clientParams: { "app_language": "id-ID", "device_platform": "web" }
});

// Fungsi koneksi dengan proteksi agar server tidak mati jika gagal
function connectTikTok() {
    console.log(`[SYSTEM] Mencoba menyambungkan ke @${tiktokUsername}...`);
    tiktokConn.connect().then(() => {
        console.log(`✅ Berhasil terhubung ke Live TikTok @${tiktokUsername}`);
    }).catch(err => {
        console.error("❌ Gagal Konek TikTok (Mungkin IP diblokir atau sedang offline):", err.message);
        // Coba lagi dalam 15 detik tanpa mematikan server
        setTimeout(connectTikTok, 15000);
    });
}

connectTikTok();

// --- EVENT HANDLERS ---

tiktokConn.on('chat', (data) => {
    chatQueue.push({ user: data.uniqueId, msg: data.comment });
    processQueue();
});

tiktokConn.on('gift', (data) => {
    console.log(`[GIFT] @${data.uniqueId} memberikan ${data.giftName}`);
    chatQueue.unshift({
        user: "DONATUR " + data.uniqueId,
        msg: `MEMBERIKAN ${data.giftName.toUpperCase()}!`,
        answer: `Wah, makasih banyak Kak ${data.uniqueId} buat ${data.giftName}-nya! Sehat selalu ya!`
    });
    processQueue();
});

tiktokConn.on('join', (data) => {
    io.emit('userJoin', { 
        user: data.uniqueId, 
        msg: `Selamat datang Kak ${data.uniqueId}! 😊` 
    });
});

tiktokConn.on('roomUser', data => io.emit('viewerCount', data.viewerCount));

// Jika koneksi terputus tiba-tiba, hubungkan kembali secara otomatis
tiktokConn.on('disconnected', () => {
    console.log("⚠️ Koneksi TikTok terputus! Mencoba menyambung ulang...");
    connectTikTok();
});

// --- ROUTING ---
app.get('/', (req, res) => {
    res.render('public');
});

// Menangani error tak terduga agar server tetap menyala (Always ON)
process.on('uncaughtException', (err) => {
    console.error('CRITICAL ERROR:', err);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
-------------------------------------------------
🚀 WAFABOT SERVER RUNNING
-------------------------------------------------
PORT   : ${PORT}
STATUS : ONLINE
URL    : http://0.0.0.0:${PORT}
-------------------------------------------------
    `);
});
