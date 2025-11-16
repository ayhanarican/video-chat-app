// Socket.io baglantisi
const socket = io('http://localhost:3000');
console.log(location.href)
// DOM elementleri
const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const userNameInput = document.getElementById('user-name');
const roomIdInput = document.getElementById('room-id');
const joinBtn = document.getElementById('join-btn');
const localVideo = document.getElementById('local-video');
const screenVideo = document.getElementById('screen-video');
const cameraGrid = document.getElementById('camera-grid');
const toggleCameraBtn = document.getElementById('toggle-camera');
const toggleMicBtn = document.getElementById('toggle-mic');
const shareScreenBtn = document.getElementById('share-screen-btn');
const stopScreenBtn = document.getElementById('stop-screen-btn');
const leaveBtn = document.getElementById('leave-btn');
const chatSidebar = document.getElementById('chat-sidebar');
const chatToggleBtn = document.getElementById('chat-toggle-btn');
const closeChatBtn = document.getElementById('close-chat-btn');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendMessageBtn = document.getElementById('send-message-btn');
const roomNameSpan = document.getElementById('room-name');
const userCountSpan = document.getElementById('user-count');
const unreadBadge = document.getElementById('unread-badge');
const avatarGrid = document.getElementById('avatar-grid');
const localAvatar = document.getElementById('local-avatar');
const raiseHandBtn = document.getElementById('raise-hand-btn');
const reactionBtn = document.getElementById('reaction-btn');
const reactionPicker = document.getElementById('reaction-picker');
const reactionsContainer = document.getElementById('reactions-container');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const connectionQuality = document.getElementById('connection-quality');
const qualityText = document.getElementById('quality-text');
const localHandIcon = document.getElementById('local-hand-icon');

let localStream = null;
let screenStream = null;
let audioContext = null;
let audioAnalyser = null;
let roomId = null;
let userName = null;
let selectedAvatar = '👤';
let peers = new Map();
let isCameraEnabled = true;
let isMicEnabled = true;
let isChatOpen = false;
let unreadCount = 0;
let isHandRaised = false;
let connectionStats = { ping: 0, quality: 'good' };

const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

avatarGrid.querySelectorAll('.avatar-option').forEach(option => {
    option.addEventListener('click', function() {
        avatarGrid.querySelectorAll('.avatar-option').forEach(opt => opt.classList.remove('selected'));
        this.classList.add('selected');
        selectedAvatar = this.dataset.avatar;
        console.log(selectedAvatar)
    });
});

joinBtn.addEventListener('click', joinRoom);
roomIdInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') joinRoom(); });

async function joinRoom() {
    userName = userNameInput.value.trim() || `User-${Math.random().toString(36).substr(2, 4)}`;
    roomId = roomIdInput.value.trim() || `room-${Math.random().toString(36).substr(2, 9)}`;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
        localVideo.srcObject = localStream;
        localAvatar.textContent = selectedAvatar;
        startAudioAnalysis(localStream);
        socket.emit('join-room', { roomId, userName, avatar: selectedAvatar });
        loginScreen.classList.remove('active');
        chatScreen.classList.add('active');
        roomNameSpan.textContent = `Oda: ${roomId}`;
        addSystemMessage(`${roomId} odasına katıldınız`);
        startConnectionQualityCheck();
    } catch (error) {
        alert('Kamera veya mikrofon izni alınamadı: ' + error.message);
        console.error(error);
    }
}

function startAudioAnalysis(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioAnalyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(audioAnalyser);
    audioAnalyser.fftSize = 256;
    const bufferLength = audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    function updateAudioLevel() {
        if (!audioContext) return;
        audioAnalyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) { sum += dataArray[i]; }
        const average = sum / bufferLength;
        const level = Math.min(100, (average / 128) * 100);
        const localAudioBar = document.getElementById('local-audio-bar');
        if (localAudioBar && isMicEnabled) { localAudioBar.style.width = level + '%'; }
        requestAnimationFrame(updateAudioLevel);
    }
    updateAudioLevel();
}

function startRemoteAudioAnalysis(userId, stream) {
    if (!audioContext) return;
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    function updateRemoteLevel() {
        const audioBar = document.getElementById(`audio-bar-${userId}`);
        if (!audioBar) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) { sum += dataArray[i]; }
        const average = sum / bufferLength;
        const level = Math.min(100, (average / 128) * 100);
        audioBar.style.width = level + '%';
        requestAnimationFrame(updateRemoteLevel);
    }
    updateRemoteLevel();
}

raiseHandBtn.addEventListener('click', toggleHandRaise);

function toggleHandRaise() {
    isHandRaised = !isHandRaised;
    raiseHandBtn.classList.toggle('active', isHandRaised);
    localHandIcon.classList.toggle('hidden', !isHandRaised);
    socket.emit('raise-hand', { roomId, raised: isHandRaised });
    if (isHandRaised) { addSystemMessage(`${userName} elini kaldirdi`); }
}

socket.on('hand-raised', ({ userId, userName, raised }) => {
    const handIcon = document.getElementById(`hand-${userId}`);
    if (handIcon) { handIcon.classList.toggle('hidden', !raised); }
    if (raised) { addSystemMessage(`${userName} elini kaldirdi`); }
});

reactionBtn.addEventListener('click', () => { reactionPicker.classList.toggle('hidden'); });

document.querySelectorAll('.reaction-item').forEach(item => {
    item.addEventListener('click', function() {
        const emoji = this.dataset.reaction;
        sendReaction(emoji);
        reactionPicker.classList.add('hidden');
    });
});

function sendReaction(emoji) {
    socket.emit('send-reaction', { roomId, emoji });
    showReactionAnimation(emoji, true);
}

socket.on('reaction-received', ({ userId, userName, emoji }) => { showReactionAnimation(emoji, false); });

function showReactionAnimation(emoji, isLocal) {
    const reactionEl = document.createElement('div');
    reactionEl.className = 'reaction-emoji';
    reactionEl.textContent = emoji;
    const randomX = (Math.random() - 0.5) * 200;
    reactionEl.style.left = `${randomX}px`;
    reactionsContainer.appendChild(reactionEl);
    setTimeout(() => { reactionEl.remove(); }, 3000);
}

document.addEventListener('click', (e) => {
    if (!reactionPicker.contains(e.target) && e.target !== reactionBtn) { reactionPicker.classList.add('hidden'); }
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) { emojiPicker.classList.add('hidden'); }
});

emojiBtn.addEventListener('click', () => { emojiPicker.classList.toggle('hidden'); });

document.querySelectorAll('.emoji-item').forEach(item => {
    item.addEventListener('click', function() {
        const emoji = this.textContent;
        chatInput.value += emoji;
        chatInput.focus();
        emojiPicker.classList.add('hidden');
    });
});

function startConnectionQualityCheck() {
    setInterval(async () => {
        let totalBitrate = 0;
        let peerCount = 0;
        for (const [userId, peer] of peers.entries()) {
            if (!peer.connection) continue;
            try {
                const stats = await peer.connection.getStats();
                stats.forEach(report => {
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        if (report.bytesReceived) {
                            const bitrate = (report.bytesReceived * 8) / 1000;
                            totalBitrate += bitrate;
                            peerCount++;
                        }
                    }
                });
            } catch (error) { console.error('Stats error:', error); }
        }
        const avgBitrate = peerCount > 0 ? totalBitrate / peerCount : 0;
        let quality = 'good';
        let qualityLabel = 'İyi';
        if (avgBitrate < 100) { quality = 'poor'; qualityLabel = 'Zayıf'; }
        else if (avgBitrate < 500) { quality = 'fair'; qualityLabel = 'Orta'; }
        connectionQuality.className = `connection-quality ${quality}`;
        qualityText.textContent = qualityLabel;
        connectionStats.quality = quality;
    }, 3000);
}

chatToggleBtn.addEventListener('click', toggleChat);
closeChatBtn.addEventListener('click', toggleChat);

function toggleChat() {
    isChatOpen = !isChatOpen;
    chatSidebar.classList.toggle('open', isChatOpen);
    if (isChatOpen) { unreadCount = 0; updateUnreadBadge(); }
}

function updateUnreadBadge() {
    if (unreadCount > 0) {
        unreadBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        unreadBadge.classList.remove('hidden');
    } else {
        unreadBadge.classList.add('hidden');
    }
}

socket.on('existing-users', (users) => {
    users.forEach(user => { createPeerConnection(user.id, user.name, user.avatar || '👤', true); });
    updateUserCount(users.length + 1);
});

socket.on('user-connected', ({ userId, userName, avatar }) => {
    addSystemMessage(`${userName} odaya katıldı`);
    createPeerConnection(userId, userName, avatar || '👤', false);
});

socket.on('user-disconnected', (userId) => {
    const peer = peers.get(userId);
    if (peer) {
        if (peer.connection) peer.connection.close();
        removeVideoBox(userId);
        peers.delete(userId);
        addSystemMessage('Bir kullanıcı ayrıldı');
        updateUserCount(peers.size + 1);
    }
});

socket.on('offer', async ({ senderId, offer, streamType }) => {
    const peer = peers.get(senderId);
    if (!peer) return;
    const pc = peer.connection;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { targetId: senderId, answer: answer });
});

socket.on('answer', async ({ senderId, answer }) => {
    const peer = peers.get(senderId);
    if (peer && peer.connection) { await peer.connection.setRemoteDescription(new RTCSessionDescription(answer)); }
});

socket.on('ice-candidate', async ({ senderId, candidate }) => {
    const peer = peers.get(senderId);
    if (peer && peer.connection) {
        try { await peer.connection.addIceCandidate(new RTCIceCandidate(candidate)); }
        catch (error) { console.error('ICE candidate error:', error); }
    }
});

socket.on('chat-message', ({ userId, userName, avatar, message, timestamp }) => {
    addChatMessage(userName, avatar, message, timestamp, userId === socket.id);
    if (!isChatOpen && userId !== socket.id) { unreadCount++; updateUnreadBadge(); }
});

socket.on('room-full', () => { alert('Oda dolu! Maksimum 50 kişi olabilir.'); location.reload(); });

function createPeerConnection(userId, userName, avatar, isInitiator) {
    const pc = new RTCPeerConnection(iceServers);
    peers.set(userId, { connection: pc, name: userName, avatar: avatar, cameraStream: null, screenStream: null });
    if (localStream) { localStream.getTracks().forEach(track => { pc.addTrack(track, localStream); }); }
    pc.onicecandidate = (event) => { if (event.candidate) { socket.emit('ice-candidate', { targetId: userId, candidate: event.candidate }); } };
    pc.ontrack = (event) => {
        const [stream] = event.streams;
        handleRemoteStream(userId, stream);
        if (stream.getAudioTracks().length > 0) { startRemoteAudioAnalysis(userId, stream); }
    };
    pc.onconnectionstatechange = () => { console.log(`${userId} baglanti durumu:`, pc.connectionState); };
    if (isInitiator) { createOffer(userId); }
    enhanceCreatePeerConnection(userId, userName, avatar, isInitiator);
    createVideoBox(userId, userName, avatar);
}

async function createOffer(targetId) {
    const peer = peers.get(targetId);
    if (!peer) return;
    const offer = await peer.connection.createOffer();
    await peer.connection.setLocalDescription(offer);
    socket.emit('offer', { targetId, offer: offer, streamType: 'camera' });
}

function handleRemoteStream(userId, stream) {
    const peer = peers.get(userId);
    if (!peer) return;
    
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
    
    // Ekran mi kamera mi kontrol et
    const settings = videoTrack.getSettings();
    const isScreen = settings.width > 1920 || settings.height > 1080;
    
    if (isScreen) {
        // EKRAN - buyuk ekranda goster
        screenVideo.srcObject = stream;
        screenVideo.parentElement.querySelector('.no-screen').style.display = 'none';
        peer.screenStream = stream;
        console.log('Screen stream received from:', userId);
    } else {
        // KAMERA - kucuk kutuda goster
        const videoBox = document.getElementById(`video-${userId}`);
        if (videoBox) {
            const video = videoBox.querySelector('video');
            if (video) { 
                video.srcObject = stream; 
                peer.cameraStream = stream;
            }
        }
        
        // Ses analizi
        if (stream.getAudioTracks().length > 0) { 
            startRemoteAudioAnalysis(userId, stream); 
        }
    }
}

function createVideoBox(userId, userName, avatar) {
    const existingBox = document.getElementById(`video-${userId}`);
    if (existingBox) return;
    const videoBox = document.createElement('div');
    videoBox.className = 'video-box';
    videoBox.id = `video-${userId}`;
    videoBox.innerHTML = `<video autoplay playsinline></video><div class="video-label"><span class="message-avatar">${avatar}</span> ${userName}</div><div class="audio-level-indicator"><div class="audio-level-bar" id="audio-bar-${userId}"></div></div><div class="hand-raised-icon hidden" id="hand-${userId}">âœ‹</div>`;
    cameraGrid.appendChild(videoBox);
    updateUserCount(peers.size + 1);
}

function removeVideoBox(userId) {
    const videoBox = document.getElementById(`video-${userId}`);
    if (videoBox) { videoBox.remove(); }
}

shareScreenBtn.addEventListener('click', async () => {
    try {
        // Ekran stream'i al - SADECE video
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: { cursor: 'always' },
            audio: false  // Ses localStream'den gelsin
        });
        
        // Lokal ekranda goster
        screenVideo.srcObject = displayStream;
        screenVideo.parentElement.querySelector('.no-screen').style.display = 'none';
        
        const screenTrack = displayStream.getVideoTracks()[0];
        
        // Her peer'a ekran track'ini gonder
        peers.forEach((peer, userId) => {
            const senders = peer.connection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            
            if (videoSender) {
                // Video track'i ekranla degistir
                videoSender.replaceTrack(screenTrack).then(() => {
                    console.log('Ekran paylasimi basladi:', userId);
                }).catch(err => console.error('Track replace error:', err));
            } else {
                // Sender yoksa ekle
                peer.connection.addTrack(screenTrack, displayStream);
                createOffer(userId);
            }
        });
        
        screenStream = displayStream;
        shareScreenBtn.classList.add('hidden');
        stopScreenBtn.classList.remove('hidden');
        
        // Ekran paylasimi durdurulunca
        screenTrack.onended = () => { stopScreenSharing(); };
        
        addSystemMessage('Ekran paylasimi basladi');
        
    } catch (error) { 
        console.error('Ekran paylasimi hatasi:', error); 
        alert('Ekran paylasimi baslatilamadi!');
    }
});

stopScreenBtn.addEventListener('click', stopScreenSharing);

function stopScreenSharing() {
    if (!screenStream) return;
    
    // Ekran stream'ini durdur
    screenStream.getTracks().forEach(track => track.stop());
    
    // Lokal ekrani temizle
    screenVideo.srcObject = null;
    screenVideo.parentElement.querySelector('.no-screen').style.display = 'flex';
    
    // Her peer'a kamera track'ini geri ver
    if (localStream) {
        const cameraTrack = localStream.getVideoTracks()[0];
        
        peers.forEach((peer, userId) => {
            const senders = peer.connection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            
            if (videoSender && cameraTrack) {
                videoSender.replaceTrack(cameraTrack).then(() => {
                    console.log('Kamera geri yuklendi:', userId);
                }).catch(err => console.error('Kamera yuklenemedi:', err));
            }
        });
    }
    
    screenStream = null;
    shareScreenBtn.classList.remove('hidden');
    stopScreenBtn.classList.add('hidden');
    
    addSystemMessage('Ekran paylaşımı durduruldu');
}

toggleCameraBtn.addEventListener('click', () => {
    isCameraEnabled = !isCameraEnabled;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = isCameraEnabled;
        toggleCameraBtn.classList.toggle('active', isCameraEnabled);
        toggleCameraBtn.textContent = isCameraEnabled ? '📹' : '🚫';
    }
});

toggleMicBtn.addEventListener('click', () => {
    isMicEnabled = !isMicEnabled;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = isMicEnabled;
        toggleMicBtn.classList.toggle('active', isMicEnabled);
        toggleMicBtn.textContent = isMicEnabled ? '🎤' : '🔇';
    }
});

sendMessageBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;
    socket.emit('chat-message', { roomId, message, type: 'text' });
    chatInput.value = '';
}

function addChatMessage(userName, avatar, message, timestamp, isOwn) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isOwn ? 'own' : ''}`;
    const time = new Date(timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    messageDiv.innerHTML = `<div class="message-header"><span class="message-user"><span class="message-avatar">${avatar}</span> ${userName}</span><span class="message-time">${time}</span></div><div class="message-text">${escapeHtml(message)}</div>`;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'system-message';
    messageDiv.textContent = message;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateUserCount(count) { userCountSpan.textContent = `👥 ${count}`; }

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

leaveBtn.addEventListener('click', () => {
    if (confirm('Odadan ayrılmak istediğinizden emin misiniz?')) { location.reload(); }
});

window.addEventListener('beforeunload', () => {
    if (localStream) { localStream.getTracks().forEach(track => track.stop()); }
    if (screenStream) { screenStream.getTracks().forEach(track => track.stop()); }
    if (audioContext) { audioContext.close(); }
});

// YENI OZELLIKLER - Ek DOM elementleri
const recordScreenBtn = document.getElementById('record-screen-btn');
const stopRecordBtn = document.getElementById('stop-record-btn');
const sendFileBtn = document.getElementById('send-file-btn');
const fileInput = document.getElementById('file-input');
const saveChatBtn = document.getElementById('save-chat-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const bgEffectBtn = document.getElementById('bg-effect-btn');
const bgEffectMenu = document.getElementById('bg-effect-menu');

// Ekran kaydi degiskenleri
let mediaRecorder = null;
let recordedChunks = [];
let currentBgEffect = 'none';

// Data Channel for file transfer
let dataChannels = new Map();

// ==================== EKRAN KAYDI (Screen Recording) ====================

if (recordScreenBtn) {
    recordScreenBtn.addEventListener('click', startScreenRecording);
}

if (stopRecordBtn) {
    stopRecordBtn.addEventListener('click', stopScreenRecording);
}

async function startScreenRecording() {
    try {
        const stream = screenVideo.srcObject || await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        
        if (!screenVideo.srcObject) {
            screenVideo.srcObject = stream;
            screenVideo.parentElement.querySelector('.no-screen').style.display = 'none';
        }

        const options = { mimeType: 'video/webm;codecs=vp9' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm';
        }

        mediaRecorder = new MediaRecorder(stream, options);
        recordedChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `screen-recording-${Date.now()}.webm`;
            a.click();
            URL.revokeObjectURL(url);
            
            addSystemMessage('Ekran kaydı indirildi');
        };

        mediaRecorder.start(1000);
        recordScreenBtn.classList.add('hidden');
        stopRecordBtn.classList.remove('hidden');
        
        addSystemMessage('Ekran kaydı başladı');

    } catch (error) {
        console.error('Ekran kaydı başlatılamadı:', error);
        alert('Ekran kaydı başlatılamadı!');
    }
}

function stopScreenRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        recordScreenBtn.classList.remove('hidden');
        stopRecordBtn.classList.add('hidden');
        addSystemMessage('Ekran kaydi durduruldu');
    }
}

// ==================== DOSYA PAYLASIMI (File Sharing) ====================

if (sendFileBtn) {
    sendFileBtn.addEventListener('click', () => {
        fileInput.click();
    });
}

if (fileInput) {
    fileInput.addEventListener('change', handleFileSelect);
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
        alert('Dosya boyutu 50MB dan küçük olmalıdır!');
        return;
    }

    sendFileToAll(file);
    event.target.value = '';
}

function sendFileToAll(file) {
    const reader = new FileReader();
    
    reader.onload = (e) => {
        const arrayBuffer = e.target.result;
        const metadata = {
            name: file.name,
            size: file.size,
            type: file.type
        };

        peers.forEach((peer, userId) => {
            if (!peer.dataChannel) {
                peer.dataChannel = peer.connection.createDataChannel('fileTransfer');
                setupDataChannel(peer.dataChannel, userId);
            }

            if (peer.dataChannel.readyState === 'open') {
                peer.dataChannel.send(JSON.stringify({ type: 'metadata', data: metadata }));
                
                const chunkSize = 16384;
                for (let offset = 0; offset < arrayBuffer.byteLength; offset += chunkSize) {
                    const chunk = arrayBuffer.slice(offset, offset + chunkSize);
                    peer.dataChannel.send(chunk);
                }
                
                peer.dataChannel.send(JSON.stringify({ type: 'end' }));
            }
        });

        addSystemMessage(`Dosya gonderiliyor: ${file.name}`);
    };

    reader.readAsArrayBuffer(file);
}

function setupDataChannel(channel, userId) {
    let receivedData = [];
    let fileMetadata = null;

    channel.onmessage = (event) => {
        if (typeof event.data === 'string') {
            const message = JSON.parse(event.data);
            
            if (message.type === 'metadata') {
                fileMetadata = message.data;
                receivedData = [];
                addSystemMessage(`Dosya alınıyor: ${fileMetadata.name}`);
            } else if (message.type === 'end') {
                const blob = new Blob(receivedData, { type: fileMetadata.type });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileMetadata.name;
                a.click();
                URL.revokeObjectURL(url);
                
                addSystemMessage(`Dosya indirildi: ${fileMetadata.name}`);
                receivedData = [];
                fileMetadata = null;
            }
        } else {
            receivedData.push(event.data);
        }
    };
}

// ==================== CHAT GECMISI (Chat History) ====================

if (saveChatBtn) {
    saveChatBtn.addEventListener('click', saveChatHistory);
}

if (clearChatBtn) {
    clearChatBtn.addEventListener('click', clearChatHistory);
}

function saveChatHistory() {
    const messages = Array.from(chatMessages.children).map(msg => {
        if (msg.classList.contains('system-message')) {
            return { type: 'system', text: msg.textContent };
        } else {
            const user = msg.querySelector('.message-user').textContent;
            const time = msg.querySelector('.message-time').textContent;
            const text = msg.querySelector('.message-text').textContent;
            return { type: 'user', user, time, text };
        }
    });

    const chatData = {
        roomId: roomId,
        date: new Date().toISOString(),
        messages: messages
    };

    const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-history-${roomId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    addSystemMessage('Chat geçmişi kaydedildi');
}

function clearChatHistory() {
    if (confirm('Tüm chat geçmişini silmek istediginizden emin misiniz?')) {
        chatMessages.innerHTML = '';
        addSystemMessage('Chat geçmişi temizlendi');
    }
}

// ==================== ARKA PLAN EFEKTLERI (Background Effects) ====================

if (bgEffectBtn) {
    bgEffectBtn.addEventListener('click', () => {
        bgEffectMenu.classList.toggle('hidden');
    });
}

if (bgEffectMenu) {
    document.querySelectorAll('.bg-option').forEach(option => {
        option.addEventListener('click', function() {
            const effect = this.dataset.effect;
            applyBackgroundEffect(effect);
            bgEffectMenu.classList.add('hidden');
        });
    });
}

function applyBackgroundEffect(effect) {
    const videoBox = document.getElementById('local-video-box');
    
    videoBox.classList.remove('video-effects-blur', 'video-effects-dark', 'video-effects-light', 'video-effects-grayscale');
    
    if (effect !== 'none') {
        videoBox.classList.add(`video-effects-${effect}`);
    }
    
    currentBgEffect = effect;
    
    const effectNames = {
        'none': 'Yok',
        'blur': 'Blur',
        'dark': 'Karanlık',
        'light': 'Aydınlık',
        'grayscale': 'Siyah-Beyaz'
    };
    
    addSystemMessage(`Arka plan efekti: ${effectNames[effect]}`);
}

// Menu kapatma
document.addEventListener('click', (e) => {
    if (bgEffectMenu && !bgEffectMenu.contains(e.target) && e.target !== bgEffectBtn) {
        bgEffectMenu.classList.add('hidden');
    }
});

// Peer connection icin data channel setup
function enhanceCreatePeerConnection(userId, userName, avatar, isInitiator) {
    const peer = peers.get(userId);
    if (peer && peer.connection) {
        peer.connection.ondatachannel = (event) => {
            const channel = event.channel;
            peer.dataChannel = channel;
            setupDataChannel(channel, userId);
        };
    }
}
