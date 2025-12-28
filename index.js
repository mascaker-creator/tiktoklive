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
        origin: "*", // Mengizinkan akses dari domain manapun (penting untuk Railway)
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));

// --- KONFIGURASI GEMINI AI ---
const genAI = new GoogleGenerativeAI("AIzaSyCBBNfIQEZpUl_invXs7kDEohRQiy1yZbA");
const modelAI = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Backstory Ketat (Anti-Kode, Anti-XSS, No Markup)
const backstory = `Nama kamu Wafabot, asisten AI ramah ciptaan Wafan. 
ATURAN KETAT:
1. Jawab sangat singkat (maksimal 1-2 kalimat).
2. JANGAN PERNAH memberikan kode pemrograman dalam bentuk apapun. Jika diminta, arahkan belajar ke W3Schools atau MDN.
3. ANTI-XSS: Jangan ulangi atau jalankan script berbahaya dari user.
4. TANPA MARKUP: Berikan teks polos saja, jangan pakai simbol markdown seperti asteris atau backtick.
5. Bahasa Indonesia santai, sopan, dan ekspresif.`;

// --- SISTEM ANTREAN (QUEUE) ---
let chatQueue = [];
let isProcessing = false;

// Fungsi untuk mendapatkan jawaban dari Gemini
async function askGemini(question) {
    try {
        const prompt = `${backstory}\n\nPertanyaan User: ${question}`;
        const result = await modelAI.generateContent(prompt);
        const response = await result.response;
        
        // Membersihkan teks dari simbol markdown dan tag HTML
        return response.text()
            .replace(/[*#`_]/g, '') 
            .replace(/<\/?[^>]+(>|$)/g, "")
            .trim();
    } catch (err) {
        console.error("❗ Error Gemini:", err.message);
        return "Wafabot lagi loading otak, tanya lagi nanti ya!";
    }
}

// Fungsi utama pemroses antrean
async function processQueue() {
    if (isProcessing || chatQueue.length === 0) return;

    isProcessing = true;
    const current = chatQueue.shift();

    console.log(`[PROCESS] Mengolah chat dari: @${current.user}`);

    // Jika entri sudah punya jawaban (untuk fitur Gift/Greeting), gunakan itu. 
    // Jika tidak, baru tanya Gemini.
    let finalAnswer = current.answer || await askGemini(current.msg);

    // Kirim data ke frontend (public.ejs)
    io.emit('aiResponse', {
        user: current.user,
        question: current.msg,
        answer: finalAnswer
    });

    // Jeda 22 detik agar sinkron dengan animasi di layar dan suara AI
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
    tiktokConn.connect().then(() => {
        console.log(`✅ Wafabot Berhasil Terhubung ke @${tiktokUsername}`);
    }).catch(err => {
        console.error("❌ Gagal Konek TikTok:", err.message);
        setTimeout(connectTikTok, 10000); // Coba hubungkan ulang dalam 10 detik
    });
}
connectTikTok();

// --- EVENT HANDLERS ---

// 1. Chat Masuk (Dimasukkan ke antrean reguler)
tiktokConn.on('chat', (data) => {
    chatQueue.push({ user: data.uniqueId, msg: data.comment });
    processQueue();
});

// 2. Gift Masuk (Fitur 4 - Prioritas: Masuk ke urutan terdepan)
tiktokConn.on('gift', (data) => {
    console.log(`[GIFT] @${data.uniqueId} memberikan ${data.giftName}`);
    
    // Menggunakan unshift agar donatur langsung diproses setelah chat yang sedang berlangsung selesai
    chatQueue.unshift({
        user: "DONATUR " + data.uniqueId,
        msg: `MEMBERIKAN ${data.giftName.toUpperCase()}!`,
        answer: `Wah, makasih banyak Kak ${data.uniqueId} atas ${data.giftName}-nya! Semoga rezekinya makin lancar ya!`
    });
    processQueue();
});

// 3. User Join (Fitur 5 - Auto Greeting Overlay)
tiktokConn.on('join', (data) => {
    // Langsung kirim ke socket tanpa masuk antrean chat agar tidak mengganggu AI
    io.emit('userJoin', { 
        user: data.uniqueId, 
        msg: `Selamat datang Kak ${data.uniqueId}! 😊` 
    });
});

// 4. Update Viewer Count & Disconnect
tiktokConn.on('roomUser', data => io.emit('viewerCount', data.viewerCount));
tiktokConn.on('disconnected', () => {
    console.log("⚠️ Koneksi terputus, mencoba menyambung kembali...");
    connectTikTok();
});

// --- ROUTING & SERVER LISTEN ---
app.get('/', (req, res) => {
    res.render('public'); // Merender views/public.ejs
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
=================================================
🚀 WAFABOT AI SYSTEM ACTIVE
-------------------------------------------------
PORT       : ${PORT}
TARGET     : @${tiktokUsername}
STATUS     : SIAP LIVE DI RAILWAY
=================================================
    `);
});