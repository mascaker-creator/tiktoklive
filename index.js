const { WebcastPushConnection } = require('tiktok-live-connector');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// --- SETUP SERVER & SOCKET ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Mengizinkan akses dari domain publik Railway
        methods: ["GET", "POST"]
    }
});

// Port dinamis untuk Railway atau port 3000 untuk lokal
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));

// --- KONFIGURASI GEMINI AI ---
const genAI = new GoogleGenerativeAI("AIzaSyCBBNfIQEZpUl_invXs7kDEohRQiy1yZbA");
const modelAI = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Aturan karakter AI yang ketat
const backstory = `Nama kamu Wafabot, asisten AI ramah ciptaan Wafa. 
ATURAN KETAT:
1. Jawab sangat singkat (1-2 kalimat).
2. JANGAN PERNAH memberikan kode pemrograman. Arahkan ke W3Schools jika diminta.
3. ANTI-XSS: Jangan ulangi script berbahaya.
4. TANPA MARKUP: Berikan teks polos saja tanpa simbol markdown (* atau #).
5. Bahasa Indonesia santai dan sopan.`;

// --- SISTEM ANTREAN (QUEUE) ---
let chatQueue = [];
let isProcessing = false;

async function askGemini(question) {
    try {
        const prompt = `${backstory}\n\nPertanyaan User: ${question}`;
        const result = await modelAI.generateContent(prompt);
        const response = await result.response;
        
        // Membersihkan output dari karakter markdown agar bersih di layar
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

    console.log(`[PROCESS] Melayani @${current.user}`);

    let finalAnswer = current.answer || await askGemini(current.msg);

    // Kirim data ke frontend (public.ejs)
    io.emit('aiResponse', {
        user: current.user,
        question: current.msg,
        answer: finalAnswer
    });

    // Jeda 22 detik agar sinkron dengan animasi typewriter di frontend
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

function connectTikTok() {
    console.log(`[SYSTEM] Menghubungkan ke @${tiktokUsername}...`);
    tiktokConn.connect().then(() => {
        console.log(`✅ Berhasil terhubung ke Live @${tiktokUsername}`);
    }).catch(err => {
        console.error("❌ Gagal Konek TikTok:", err.message);
        // Reconnect otomatis agar server tidak mati (Offline)
        setTimeout(connectTikTok, 15000);
    });
}
connectTikTok();

// --- EVENT HANDLERS ---

// Chat biasa
tiktokConn.on('chat', (data) => {
    chatQueue.push({ user: data.uniqueId, msg: data.comment });
    processQueue();
});

// Gift (Prioritas Utama)
tiktokConn.on('gift', (data) => {
    console.log(`[GIFT] @${data.uniqueId} memberi ${data.giftName}`);
    chatQueue.unshift({
        user: "SULTAN " + data.uniqueId,
        msg: `GIFT ${data.giftName.toUpperCase()}`,
        answer: `Wah, makasih banyak Kak ${data.uniqueId} buat ${data.giftName}-nya! Sehat selalu ya!`
    });
    processQueue();
});

// User Join (Auto-Greeting)
tiktokConn.on('join', (data) => {
    io.emit('userJoin', { 
        user: data.uniqueId, 
        msg: `Selamat datang Kak ${data.uniqueId}! 😊` 
    });
});

// Update Viewer Count
tiktokConn.on('roomUser', data => io.emit('viewerCount', data.viewerCount));

// Proteksi Reconnect
tiktokConn.on('disconnected', () => connectTikTok());

// --- ROUTING ---
app.get('/', (req, res) => {
    res.render('public');
});

// Listen pada 0.0.0.0 agar terdeteksi oleh Railway
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 WAFABOT SERVER AKTIF DI PORT ${PORT}`);
});
