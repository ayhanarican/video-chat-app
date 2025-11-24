// Socket.io baglantisi
const socket = io('https://meet.kobicrm.net');
console.log('🌐 Socket bağlantısı başlatıldı');

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
let currentScreenSharerId = null;
let isLocalSharingScreen = false;

// 👑 ADMIN ÖZELLİKLERİ
let isAdmin = false;
let adminId = null;

// 🖥️ ARKA PLAN GÖRÜNTÜLERİ
let currentBackgroundUserId = null;
let currentBackgroundType = null; // 'camera' veya 'screen'

// 🆕 Peer bağlantı durumunu takip et
let peersConnected = 0;
let totalPeersExpected = 0;
let pendingBackgroundToShow = null; // { userId, type }

// 🆕 Hangi kullanıcının hangi stream türünü paylaştığını takip et
let userStreamTypes = new Map(); // userId -> 'camera' | 'screen'

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
    });
});

joinBtn.addEventListener('click', joinRoom);
roomIdInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') joinRoom(); });

async function joinRoom() {
    userName = userNameInput.value.trim() || `User-${Math.random().toString(36).substr(2, 4)}`;
    roomId = roomIdInput.value.trim() || `room-${Math.random().toString(36).substr(2, 9)}`;

    try {
        console.log('🎥 Kamera ve mikrofon izni isteniyor...');
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 1280, height: 720 }, 
            audio: true 
        });
        console.log('✅ Local stream alındı:', {
            videoTracks: localStream.getVideoTracks().length,
            audioTracks: localStream.getAudioTracks().length
        });
        
        localVideo.srcObject = localStream;
        localAvatar.textContent = selectedAvatar;
        startAudioAnalysis(localStream);
        
        // Kendi stream türünü ayarla
        userStreamTypes.set(socket.id, 'camera');
        
        console.log('📤 Odaya katılma isteği gönderiliyor:', roomId);
        socket.emit('join-room', { roomId, userName, avatar: selectedAvatar });
        
        loginScreen.classList.remove('active');
        chatScreen.classList.add('active');
        roomNameSpan.textContent = `Oda: ${roomId}`;
        addSystemMessage(`${roomId} odasına katıldınız`);
        startConnectionQualityCheck();

        setTimeout(setupLocalVideoClick, 500);
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
    if (isHandRaised) { addSystemMessage(`${userName} elini kaldırdı`); }
}

socket.on('hand-raised', ({ userId, userName, raised }) => {
    const handIcon = document.getElementById(`hand-${userId}`);
    if (handIcon) { handIcon.classList.toggle('hidden', !raised); }
    if (raised) { addSystemMessage(`${userName} elini kaldırdı`); }
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

socket.on('reaction-received', ({ userId, userName, emoji }) => { 
    showReactionAnimation(emoji, false); 
});

function showReactionAnimation(emoji, isLocal) {
    const reactionEl = document.createElement('div');
    reactionEl.className = 'reaction-emoji';
    reactionEl.textContent = emoji;
    const randomX = (Math.random() - 0.5) * 200;
    reactionEl.style.left = `${randomX}px`;
    reactionsContainer.appendChild(reactionEl);
    setTimeout(() => { reactionEl.remove(); }, 9000);
}

document.addEventListener('click', (e) => {
    if (!reactionPicker.contains(e.target) && e.target !== reactionBtn) { 
        reactionPicker.classList.add('hidden'); 
    }
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) { 
        emojiPicker.classList.add('hidden'); 
    }
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

// ==================== 👑 ADMIN SİSTEMİ ====================

socket.on('existing-users', ({ users, adminId: serverAdminId, currentBackground }) => {
    console.log('✅ Mevcut kullanıcılar:', users);
    console.log('👑 Admin ID:', serverAdminId);
    console.log('📺 Mevcut arka plan:', currentBackground);
    
    adminId = serverAdminId;
    isAdmin = (socket.id === serverAdminId);
    
    if (isAdmin) {
        console.log('👑 SEN ADMİNSİN!');
        addSystemMessage('🎉 Sen bu odanın yöneticisisin!');
        setTimeout(() => {
            updateAdminBadge(socket.id, true);
            setupLocalVideoClick();
        }, 500);
    }
    
    // Peer sayısını ayarla
    totalPeersExpected = users.length;
    peersConnected = 0;
    
    // Her kullanıcının stream türünü kaydet
    users.forEach(user => {
        userStreamTypes.set(user.id, user.currentStreamType || 'camera');
        console.log(`📝 ${user.name} stream türü: ${user.currentStreamType || 'camera'}`);
    });
    
    // Arka plan bilgisini kaydet
    if (currentBackground && currentBackground.userId && currentBackground.type) {
        pendingBackgroundToShow = currentBackground;
        console.log('📺 Arka plan bilgisi kaydedildi, peer\'lar hazır olunca gösterilecek');
    } else {
        console.log('📺 Arka plan boş');
        pendingBackgroundToShow = null;
    }
    
    users.forEach(user => { 
        createPeerConnection(user.id, user.name, user.avatar || '👤', true);
        
        setTimeout(() => {
            if (user.isAdmin) {
                console.log('👑 Remote user admin, badge ekleniyor:', user.id);
                updateAdminBadge(user.id, true);
            }
            if (user.isSharingScreen) {
                console.log('🖥️ Remote user ekran paylaşıyor, badge ekleniyor:', user.id);
                const peer = peers.get(user.id);
                if (peer) {
                    peer.isScreenSharing = true;
                    updateScreenShareBadge(user.id, true);
                }
            }
        }, 200);
    });
    updateUserCount(users.length + 1);
});

// 🆕 Kullanıcı stream türü değişti
socket.on('user-stream-type-changed', ({ userId, streamType }) => {
    console.log(`🔄 ${userId} stream türü değişti:`, streamType);
    userStreamTypes.set(userId, streamType);
});

// 🆕 Peer bağlantısı kurulduğunda çağrılır
function onPeerConnected() {
    peersConnected++;
    console.log(`✅ Peer bağlantısı tamamlandı: ${peersConnected}/${totalPeersExpected}`);
    
    // Tüm peer'lar bağlandıysa ve bekleyen arka plan varsa göster
    if (peersConnected >= totalPeersExpected) {
        if (pendingBackgroundToShow) {
            console.log('🎯 Tüm peer\'lar hazır, arka plan gösteriliyor');
            
            // Server'a peer'ların hazır olduğunu bildir
            socket.emit('peers-ready', { roomId });
            
            // Lokal olarak da arka planı göster
            setTimeout(() => {
                showPendingBackground();
            }, 1000);
        } else {
            console.log('📺 Peer\'lar hazır ama arka plan yok');
        }
    }
}

// Bekleyen arka planı göster
function showPendingBackground() {
    if (!pendingBackgroundToShow) {
        console.log('📺 Bekleyen arka plan yok, atlanıyor');
        return;
    }
    
    const { userId, type } = pendingBackgroundToShow;
    console.log('📺 Bekleyen arka plan gösteriliyor:', { userId, type });
    
    let stream;
    if (userId === socket.id) {
        stream = type === 'screen' ? screenStream : localStream;
    } else {
        const peer = peers.get(userId);
        if (peer && peer.remoteStream && peer.remoteStream.getTracks().length > 0) {
            stream = peer.remoteStream;
        }
    }
    
    if (stream && stream.getTracks().length > 0) {
        showBackgroundVideo(stream, userId, type);
        console.log('✅ Bekleyen arka plan gösterildi');
        pendingBackgroundToShow = null;
    } else {
        console.warn('⚠️ Stream bulunamadı veya boş, biraz daha bekleniyor...');
        setTimeout(() => {
            showPendingBackground();
        }, 1000);
    }
}

socket.on('user-connected', ({ userId, userName, avatar, isAdmin: userIsAdmin }) => {
    console.log('🆕 Yeni kullanıcı bağlandı:', userId, userName, 'Admin:', userIsAdmin);
    addSystemMessage(`${userName} odaya katıldı`);
    
    // Yeni kullanıcı kamera ile başlar
    userStreamTypes.set(userId, 'camera');
    
    createPeerConnection(userId, userName, avatar || '👤', false);
    
    if (userIsAdmin) {
        setTimeout(() => {
            console.log('👑 Yeni kullanıcı admin, badge ekleniyor:', userId);
            updateAdminBadge(userId, true);
        }, 200);
    }
});

socket.on('admin-updated', ({ adminId: newAdminId, oldAdminName, newAdminName }) => {
    console.log('👑 Admin güncellendi:', newAdminId);
    
    if (adminId) {
        updateAdminBadge(adminId, false);
    }
    
    adminId = newAdminId;
    isAdmin = (socket.id === newAdminId);
    
    updateAdminBadge(newAdminId, true);
    
    if (isAdmin) {
        console.log('👑 SEN ADMİN OLDUN!');
        addSystemMessage('🎉 Artık sen bu odanın yöneticisisin!');
        setupLocalVideoClick();
    } else {
        if (newAdminName) {
            addSystemMessage(`👑 ${newAdminName} artık oda yöneticisi`);
        }
    }
    
    updateAllVideoBoxesClickability();
});

function updateAdminBadge(userId, show) {
    console.log('👑 updateAdminBadge çağrıldı:', userId, show ? 'GÖSTER' : 'GİZLE');
    
    if (userId === socket.id) {
        const localVideoBox = document.getElementById('local-video-box');
        if (!localVideoBox) {
            console.error('❌ local-video-box bulunamadı!');
            return;
        }
        
        let localBadge = localVideoBox.querySelector('.admin-badge');
        if (show && !localBadge) {
            localBadge = document.createElement('div');
            localBadge.className = 'admin-badge';
            localBadge.textContent = '👑';
            localBadge.title = 'Oda Yöneticisi';
            localVideoBox.appendChild(localBadge);
            console.log('✅ Local admin badge eklendi');
        } else if (!show && localBadge) {
            localBadge.remove();
            console.log('✅ Local admin badge kaldırıldı');
        }
    } else {
        const videoBox = document.getElementById(`video-${userId}`);
        if (!videoBox) {
            console.warn('⚠️ Video box bulunamadı:', userId);
            return;
        }
        
        let badge = videoBox.querySelector('.admin-badge');
        if (show && !badge) {
            badge = document.createElement('div');
            badge.className = 'admin-badge';
            badge.textContent = '👑';
            badge.title = 'Oda Yöneticisi';
            videoBox.appendChild(badge);
            console.log('✅ Remote admin badge eklendi:', userId);
        } else if (!show && badge) {
            badge.remove();
            console.log('✅ Remote admin badge kaldırıldı:', userId);
        }
    }
}

// ==================== 🖥️ EKRAN PAYLAŞIMI ====================

socket.on('user-screen-share-started', ({ userId, userName }) => {
    console.log('🖥️ Ekran paylaşımı başladı:', userId, userName);
    addSystemMessage(`${userName} ekran paylaşımı başlattı`);
    
    const peer = peers.get(userId);
    if (peer) {
        peer.isScreenSharing = true;
    }
    
    // Stream türünü güncelle
    userStreamTypes.set(userId, 'screen');
    
    if (userId === socket.id) {
        isLocalSharingScreen = true;
        setTimeout(() => updateScreenShareBadge(socket.id, true), 100);
    } else {
        setTimeout(() => updateScreenShareBadge(userId, true), 200);
    }
});

socket.on('user-screen-share-stopped', ({ userId, userName }) => {
    console.log('🛑 Ekran paylaşımı durdu:', userId, userName);
    
    const peer = peers.get(userId);
    if (peer) {
        peer.isScreenSharing = false;
        updateScreenShareBadge(userId, false);
    }
    
    // Stream türünü güncelle
    userStreamTypes.set(userId, 'camera');
    
    if (userId === socket.id) {
        isLocalSharingScreen = false;
        updateScreenShareBadge(socket.id, false);
    }
    
    if (currentBackgroundUserId === userId && currentBackgroundType === 'screen') {
        hideBackgroundVideo();
    }
    
    addSystemMessage(`${userName} ekran paylaşımını durdurdu`);
});

function updateScreenShareBadge(userId, show) {
    console.log('🖥️ updateScreenShareBadge çağrıldı:', userId, show ? 'GÖSTER' : 'GİZLE');
    
    let videoBox;
    if (userId === socket.id) {
        videoBox = document.getElementById('local-video-box');
    } else {
        videoBox = document.getElementById(`video-${userId}`);
    }
    
    if (!videoBox) {
        console.warn('⚠️ Video box bulunamadı:', userId);
        return;
    }
    
    let badge = videoBox.querySelector('.screen-share-badge');
    
    if (show && !badge) {
        badge = document.createElement('div');
        badge.className = 'screen-share-badge';
        badge.textContent = '🖥️';
        badge.title = 'Ekran Paylaşımı';
        
        if (isAdmin) {
            badge.style.cursor = 'pointer';
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                showScreenBackground(userId);
            });
        } else {
            badge.classList.add('not-clickable');
        }
        
        videoBox.appendChild(badge);
        console.log('✅ Screen share badge eklendi:', userId);
    } else if (!show && badge) {
        badge.remove();
        console.log('✅ Screen share badge kaldırıldı:', userId);
    }
}

function showScreenBackground(userId) {
    if (!isAdmin) return;
    
    console.log('🖥️ Admin ekran paylaşımını arka plana getiriyor:', userId);
    socket.emit('show-screen-background', { roomId, targetUserId: userId });
}

socket.on('screen-background-shown', ({ userId }) => {
    console.log('🖥️ Ekran paylaşımı arka plana getirildi:', userId);
    
    let streamToShow;
    let userName;
    
    if (userId === socket.id) {
        streamToShow = screenStream;
        userName = 'Sizin';
    } else {
        const peer = peers.get(userId);
        if (!peer || !peer.remoteStream) {
            console.warn('⚠️ Peer veya stream bulunamadı');
            setTimeout(() => {
                socket.emit('peers-ready', { roomId });
            }, 1000);
            return;
        }
        
        streamToShow = peer.remoteStream;
        userName = peer.name || 'Kullanıcı';
    }
    
    if (!streamToShow || streamToShow.getTracks().length === 0) {
        console.warn('⚠️ Stream bulunamadı veya boş');
        return;
    }
    
    showBackgroundVideo(streamToShow, userId, 'screen');
    addSystemMessage(`🖥️ ${userName} ekran paylaşımı tam ekran gösteriliyor`);
});

// ==================== 📹 KAMERA ARKA PLANI ====================

socket.on('camera-background-shown', ({ userId }) => {
    console.log('📹 Kamera arka plana getirildi:', userId);
    
    let stream;
    let userName;
    
    if (userId === socket.id) {
        stream = localStream;
        userName = 'Sizin';
    } else {
        const peer = peers.get(userId);
        if (!peer || !peer.remoteStream) {
            console.warn('⚠️ Peer veya stream bulunamadı');
            return;
        }
        stream = peer.remoteStream;
        userName = peer.name || 'Kullanıcı';
    }
    
    if (!stream || stream.getTracks().length === 0) {
        console.warn('⚠️ Stream bulunamadı veya boş');
        return;
    }
    
    showBackgroundVideo(stream, userId, 'camera');
    addSystemMessage(`📹 ${userName} kamerası tam ekran gösteriliyor`);
});

socket.on('background-hidden', () => {
    console.log('🚫 Arka plan görüntüsü kapatıldı');
    hideBackgroundVideo();
    addSystemMessage('Tam ekran görünüm kapatıldı');
});

function showBackgroundVideo(stream, userId, type) {
    hideBackgroundVideo();
    
    const videoContainer = document.querySelector('.video-container');
    
    const bgContainer = document.createElement('div');
    bgContainer.id = 'background-video-container';
    bgContainer.className = 'background-video-container';
    
    const bgVideo = document.createElement('video');
    bgVideo.autoplay = true;
    bgVideo.playsinline = true;
    bgVideo.muted = (userId === socket.id);
    bgVideo.srcObject = stream;
    
    if (isAdmin) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'background-close-btn';
        closeBtn.textContent = '✕ Kapat';
        closeBtn.addEventListener('click', () => {
            socket.emit('hide-background', { roomId });
        });
        bgContainer.appendChild(closeBtn);
    }
    
    const label = document.createElement('div');
    label.className = 'background-label';
    let userNameText;
    if (userId === socket.id) {
        userNameText = 'Siz';
    } else {
        const peerData = peers.get(userId);
        userNameText = peerData ? peerData.name : 'Kullanıcı';
    }
    label.textContent = `${type === 'camera' ? '📹' : '🖥️'} ${userNameText}`;
    
    bgContainer.appendChild(bgVideo);
    bgContainer.appendChild(label);
    
    videoContainer.insertBefore(bgContainer, videoContainer.firstChild);
    
    currentBackgroundUserId = userId;
    currentBackgroundType = type;
    
    console.log('✅ Arka plan video gösterimi başladı:', { userId, type });
}

function hideBackgroundVideo() {
    const bgContainer = document.getElementById('background-video-container');
    if (bgContainer) {
        bgContainer.remove();
        console.log('✅ Arka plan video kaldırıldı');
    }
    currentBackgroundUserId = null;
    currentBackgroundType = null;
}

// ==================== PEER CONNECTION & VIDEO KUTUSU ====================

socket.on('user-disconnected', (userId) => {
    console.log('👋 Kullanıcı ayrıldı:', userId);
    const peer = peers.get(userId);
    if (peer) {
        if (peer.connection) peer.connection.close();
        removeVideoBox(userId);
        peers.delete(userId);
        userStreamTypes.delete(userId);
        
        if (currentBackgroundUserId === userId) {
            hideBackgroundVideo();
        }
        
        addSystemMessage('Bir kullanıcı ayrıldı');
        updateUserCount(peers.size + 1);
    }
});

socket.on('offer', async ({ senderId, offer, streamType }) => {
    console.log('📨 OFFER alındı:', senderId, 'State:', peers.get(senderId)?.connection?.signalingState);
    const peer = peers.get(senderId);
    if (!peer) {
        console.error('❌ Peer bulunamadı:', senderId);
        return;
    }
    
    try {
        const pc = peer.connection;
        
        if (pc.signalingState === 'stable') {
            console.log('✅ Signaling state stable, offer işleniyor');
            await pc.setRemoteDescription(offer);
        } else if (pc.signalingState === 'have-local-offer') {
            const polite = !peer.isInitiator;
            console.log('⚠️ OFFER COLLISION! Polite:', polite, 'State:', pc.signalingState);
            
            if (polite) {
                console.log('🤝 Ben polite peer\'üm, rollback yapıyorum');
                await pc.setLocalDescription({ type: 'rollback' });
                await pc.setRemoteDescription(offer);
            } else {
                console.log('🚫 Ben impolite peer\'üm, gelen offer\'ı ignore ediyorum');
                return;
            }
        } else {
            console.log('⚠️ Beklenmeyen signaling state:', pc.signalingState);
            await pc.setRemoteDescription(offer);
        }
        
        console.log('✅ Remote description (offer) set edildi');
        
        if (peer.pendingCandidates && peer.pendingCandidates.length > 0) {
            console.log(`📥 ${peer.pendingCandidates.length} bekleyen ICE candidate ekleniyor...`);
            for (const candidate of peer.pendingCandidates) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                    console.error('❌ Pending ICE candidate eklenemedi:', e);
                }
            }
            peer.pendingCandidates = [];
        }
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { targetId: senderId, answer: answer });
        console.log('✅ ANSWER gönderildi');
    } catch (error) {
        console.error('❌ Offer işleme hatası:', error);
    }
});

socket.on('answer', async ({ senderId, answer }) => {
    console.log('📨 ANSWER alındı:', senderId);
    const peer = peers.get(senderId);
    if (!peer || !peer.connection) {
        console.error('❌ Peer bulunamadı');
        return;
    }
    
    try {
        const pc = peer.connection;
        console.log('📊 Answer alındığında signaling state:', pc.signalingState);
        
        if (pc.signalingState !== 'have-local-offer') {
            console.warn('⚠️ Answer beklenmiyor, state:', pc.signalingState);
            return;
        }
        
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('✅ Remote description (answer) set edildi');
        
        if (peer.pendingCandidates && peer.pendingCandidates.length > 0) {
            console.log(`📥 ${peer.pendingCandidates.length} bekleyen ICE candidate ekleniyor...`);
            for (const candidate of peer.pendingCandidates) {
                try {
                    await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                    console.error('❌ Pending ICE candidate eklenemedi:', e);
                }
            }
            peer.pendingCandidates = [];
        }
    } catch (error) {
        console.error('❌ Answer işleme hatası:', error);
    }
});

socket.on('ice-candidate', async ({ senderId, candidate }) => {
    const peer = peers.get(senderId);
    if (!peer || !peer.connection) {
        console.warn('⚠️ Peer bulunamadı, ICE candidate atlanıyor:', senderId);
        return;
    }
    
    try {
        if (!peer.connection.remoteDescription || !peer.connection.remoteDescription.type) {
            if (!peer.pendingCandidates) {
                peer.pendingCandidates = [];
            }
            peer.pendingCandidates.push(candidate);
            return;
        }
        
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
        console.error('❌ ICE candidate hatası:', error);
    }
});

socket.on('chat-message', ({ userId, userName, avatar, message, timestamp }) => {
    addChatMessage(userName, avatar, message, timestamp, userId === socket.id);
    if (!isChatOpen && userId !== socket.id) { unreadCount++; updateUnreadBadge(); }
});

socket.on('room-full', () => { 
    alert('Oda dolu! Maksimum 50 kişi olabilir.'); 
    location.reload(); 
});

function createPeerConnection(userId, userName, avatar, isInitiator) {
    console.log('🔗 Peer connection oluşturuluyor:', {
        userId,
        userName,
        isInitiator
    });
    
    const pc = new RTCPeerConnection(iceServers);
    
    peers.set(userId, { 
        connection: pc, 
        name: userName, 
        avatar: avatar, 
        remoteStream: new MediaStream(),
        isScreenSharing: false,
        makingOffer: false,
        pendingCandidates: [],
        isInitiator: isInitiator,
        isConnected: false
    });
    
    // Kendi aktif stream'ini ekle (kamera veya ekran)
    const myStreamType = userStreamTypes.get(socket.id) || 'camera';
    const streamToSend = myStreamType === 'screen' ? screenStream : localStream;
    
    if (streamToSend) { 
        streamToSend.getTracks().forEach(track => { 
            pc.addTrack(track, streamToSend); 
        }); 
        console.log(`✅ Local ${myStreamType} tracks eklendi`);
    }
    
    pc.onicecandidate = (event) => { 
        if (event.candidate) { 
            socket.emit('ice-candidate', { targetId: userId, candidate: event.candidate });
        }
    };
    
    pc.ontrack = (event) => {
        console.log('🎉 TRACK ALINDI:', event.track.kind, 'from', userId);
        
        const peer = peers.get(userId);
        if (!peer) return;
        
        peer.remoteStream.addTrack(event.track);
        console.log('✅ Remote stream tracks:', {
            video: peer.remoteStream.getVideoTracks().length,
            audio: peer.remoteStream.getAudioTracks().length
        });
        
        handleRemoteStream(userId, peer.remoteStream);
        
        // İlk track alındığında bağlantıyı başarılı say
        if (!peer.isConnected) {
            peer.isConnected = true;
            onPeerConnected();
        }
    };
    
    pc.onnegotiationneeded = async () => {
        try {
            const peer = peers.get(userId);
            if (!peer || peer.makingOffer) return;
            
            if (pc.signalingState !== 'stable') {
                console.log('⚠️ Negotiation skipped, not stable:', pc.signalingState);
                return;
            }
            
            console.log('🔄 Negotiation needed:', userId);
            peer.makingOffer = true;
            
            await pc.setLocalDescription();
            const myStreamType = userStreamTypes.get(socket.id) || 'camera';
            socket.emit('offer', { 
                targetId: userId, 
                offer: pc.localDescription,
                streamType: myStreamType
            });
            
            peer.makingOffer = false;
        } catch (error) {
            console.error('❌ Negotiation error:', error);
            const peer = peers.get(userId);
            if (peer) peer.makingOffer = false;
        }
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log(`🧊 ICE [${userId}]:`, pc.iceConnectionState);
        
        // ICE bağlantısı kurulduğunda da bağlantıyı başarılı say
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            const peer = peers.get(userId);
            if (peer && !peer.isConnected) {
                peer.isConnected = true;
                onPeerConnected();
            }
        }
    };
    
    pc.onconnectionstatechange = () => { 
        console.log(`🔌 Connection [${userId}]:`, pc.connectionState);
    };
    
    if (isInitiator) { 
        console.log('👉 Initiator, offer gönderiyorum');
        setTimeout(() => createOffer(userId), 100);
    }
    
    enhanceCreatePeerConnection(userId, userName, avatar, isInitiator);
    createVideoBox(userId, userName, avatar);
}

async function createOffer(targetId) {
    const peer = peers.get(targetId);
    if (!peer) return;
    
    try {
        peer.makingOffer = true;
        await peer.connection.setLocalDescription();
        const myStreamType = userStreamTypes.get(socket.id) || 'camera';
        socket.emit('offer', { 
            targetId, 
            offer: peer.connection.localDescription,
            streamType: myStreamType
        });
        peer.makingOffer = false;
        console.log('✅ Offer gönderildi, streamType:', myStreamType);
    } catch (error) {
        console.error('❌ Create offer error:', error);
        peer.makingOffer = false;
    }
}

function handleRemoteStream(userId, stream) {
    console.log('🎬 handleRemoteStream:', userId);
    const peer = peers.get(userId);
    if (!peer) return;
    
    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();
    
    if (videoTracks.length > 0 || audioTracks.length > 0) {
        console.log('📹 Video kutusuna stream yerleştiriliyor');
        const videoBox = document.getElementById(`video-${userId}`);
        if (videoBox) {
            const video = videoBox.querySelector('video');
            if (video) { 
                video.srcObject = stream;
                console.log('✅ Video srcObject set edildi');
                
                video.onloadedmetadata = () => {
                    video.play().catch(e => console.error('Play error:', e));
                };
            }
        }
    }
    
    if (audioTracks.length > 0) { 
        startRemoteAudioAnalysis(userId, stream); 
    }
}

function createVideoBox(userId, userName, avatar) {
    const existingBox = document.getElementById(`video-${userId}`);
    if (existingBox) {
        console.log('⚠️ Video box zaten var:', userId);
        return;
    }
    
    const videoBox = document.createElement('div');
    videoBox.className = 'video-box';
    videoBox.id = `video-${userId}`;
    
    if (isAdmin) {
        videoBox.classList.add('admin-clickable');
    }
    
    videoBox.innerHTML = `
        <video autoplay playsinline></video>
        <div class="video-label">
            <span class="message-avatar">${avatar}</span> ${userName}
        </div>
        <div class="audio-level-indicator">
            <div class="audio-level-bar" id="audio-bar-${userId}"></div>
        </div>
        <div class="hand-raised-icon hidden" id="hand-${userId}">✋</div>
    `;
    
    if (isAdmin) {
        videoBox.addEventListener('click', (e) => {
            if (e.target.classList.contains('screen-share-badge') || 
                e.target.classList.contains('admin-badge')) {
                return;
            }
            
            console.log('📹 Admin kamera görüntüsünü arka plana getiriyor:', userId);
            socket.emit('show-camera-background', { roomId, targetUserId: userId });
        });
    }
    
    cameraGrid.appendChild(videoBox);
    console.log('✅ Video box oluşturuldu:', userId);
    updateUserCount(peers.size + 1);
}

// Local video box'a da tıklama eventi (admin için)
function setupLocalVideoClick() {
    if (!isAdmin) {
        console.log('ℹ️ Admin değilsin, local video click setup atlanıyor');
        return;
    }
    
    const localVideoBox = document.getElementById('local-video-box');
    if (!localVideoBox) {
        console.warn('⚠️ Local video box henüz yok, 500ms sonra tekrar deneniyor');
        setTimeout(setupLocalVideoClick, 500);
        return;
    }
    
    localVideoBox.classList.add('admin-clickable');
    
    if (!localVideoBox.dataset.clickListenerAdded) {
        localVideoBox.addEventListener('click', handleLocalVideoClick);
        localVideoBox.dataset.clickListenerAdded = 'true';
        console.log('✅ Local video box click eventi eklendi');
    } else {
        console.log('ℹ️ Local video box click eventi zaten ekli');
    }
}

function handleLocalVideoClick(e) {
    if (e.target.classList.contains('screen-share-badge') || 
        e.target.classList.contains('admin-badge') ||
        e.target.classList.contains('control-btn') ||
        e.target.closest('.video-controls')) {
        return;
    }
    
    if (!isAdmin) return;
    
    console.log('📹 Admin kendi kamerasını arka plana getiriyor');
    socket.emit('show-camera-background', { roomId, targetUserId: socket.id });
}

function removeVideoBox(userId) {
    const videoBox = document.getElementById(`video-${userId}`);
    if (videoBox) videoBox.remove();
}

function updateAllVideoBoxesClickability() {
    document.querySelectorAll('.video-box:not(#local-video-box)').forEach(box => {
        if (isAdmin) {
            box.classList.add('admin-clickable');
        } else {
            box.classList.remove('admin-clickable');
        }
    });
    
    setupLocalVideoClick();
    
    document.querySelectorAll('.screen-share-badge').forEach(badge => {
        const videoBox = badge.closest('.video-box');
        if (!videoBox) return;
        
        let userId;
        if (videoBox.id === 'local-video-box') {
            userId = socket.id;
        } else {
            userId = videoBox.id.replace('video-', '');
        }
        
        if (isAdmin) {
            badge.style.cursor = 'pointer';
            badge.classList.remove('not-clickable');
            
            const newBadge = badge.cloneNode(true);
            badge.parentNode.replaceChild(newBadge, badge);
            
            newBadge.addEventListener('click', (e) => {
                e.stopPropagation();
                showScreenBackground(userId);
            });
        } else {
            badge.style.cursor = 'default';
            badge.classList.add('not-clickable');
        }
    });
}

// ==================== EKRAN PAYLAŞIMI KONTROLLERI ====================

shareScreenBtn.addEventListener('click', async () => {
    try {
        console.log('🖥️ Ekran paylaşımı başlatılıyor...');
        screenStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: { cursor: 'always', displaySurface: 'monitor' },
            audio: false
        });
        
        const screenTrack = screenStream.getVideoTracks()[0];
        
        // Tüm peer connection'larda video track'i değiştir
        for (const [userId, peer] of peers.entries()) {
            if (!peer || !peer.connection) {
                console.warn('⚠️ Peer bulunamadı:', userId);
                continue;
            }
            
            const senders = peer.connection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            
            if (videoSender) {
                await videoSender.replaceTrack(screenTrack);
                console.log('✅ Ekran track gönderildi:', userId);
            }
        }
        
        // Kendi stream türünü güncelle
        userStreamTypes.set(socket.id, 'screen');
        
        socket.emit('screen-share-started', { roomId });
        isLocalSharingScreen = true;
        
        shareScreenBtn.classList.add('hidden');
        stopScreenBtn.classList.remove('hidden');
        
        screenTrack.onended = () => stopScreenSharing();
        
        addSystemMessage('Ekran paylaşımınız başladı');
        
    } catch (error) { 
        console.error('❌ Ekran paylaşımı hatası:', error); 
        if (error.name !== 'NotAllowedError') {
            alert('Ekran paylaşımı başlatılamadı: ' + error.message);
        }
    }
});

stopScreenBtn.addEventListener('click', stopScreenSharing);

async function stopScreenSharing() {
    if (!screenStream) return;
    
    screenStream.getTracks().forEach(track => track.stop());
    
    // Tüm peer connection'larda video track'i tekrar kameraya çevir
    if (localStream) {
        const cameraTrack = localStream.getVideoTracks()[0];
        
        for (const [userId, peer] of peers.entries()) {
            if (!peer || !peer.connection) {
                console.warn('⚠️ Peer bulunamadı:', userId);
                continue;
            }
            
            const senders = peer.connection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            
            if (videoSender && cameraTrack) {
                await videoSender.replaceTrack(cameraTrack);
            }
        }
    }
    
    // Kendi stream türünü güncelle
    userStreamTypes.set(socket.id, 'camera');
    
    socket.emit('screen-share-stopped', { roomId });
    isLocalSharingScreen = false;
    
    screenStream = null;
    shareScreenBtn.classList.remove('hidden');
    stopScreenBtn.classList.add('hidden');
    
    addSystemMessage('Ekran paylaşımınız durduruldu');
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
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-user">
                <span class="message-avatar">${avatar}</span> ${userName}
            </span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-text">${escapeHtml(message)}</div>
    `;
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

function updateUserCount(count) { 
    userCountSpan.textContent = `👥 ${count}`; 
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

leaveBtn.addEventListener('click', () => {
    if (confirm('Odadan ayrılmak istediğinizden emin misiniz?')) { 
        location.reload(); 
    }
});

window.addEventListener('beforeunload', () => {
    if (localStream) { localStream.getTracks().forEach(track => track.stop()); }
    if (screenStream) { screenStream.getTracks().forEach(track => track.stop()); }
    if (audioContext) { audioContext.close(); }
});

// ==================== EK ÖZELLİKLER ====================

const recordScreenBtn = document.getElementById('record-screen-btn');
const stopRecordBtn = document.getElementById('stop-record-btn');
const sendFileBtn = document.getElementById('send-file-btn');
const fileInput = document.getElementById('file-input');
const saveChatBtn = document.getElementById('save-chat-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const bgEffectBtn = document.getElementById('bg-effect-btn');
const bgEffectMenu = document.getElementById('bg-effect-menu');

let mediaRecorder = null;
let recordedChunks = [];
let currentBgEffect = 'none';

if (recordScreenBtn) recordScreenBtn.addEventListener('click', startScreenRecording);
if (stopRecordBtn) stopRecordBtn.addEventListener('click', stopScreenRecording);

async function startScreenRecording() {
    try {
        const stream = screenVideo.srcObject || await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        
        if (!screenVideo.srcObject) {
            screenVideo.srcObject = stream;
            const noScreenDiv = screenVideo.parentElement.querySelector('.no-screen');
            if (noScreenDiv) noScreenDiv.style.display = 'none';
        }

        const options = { mimeType: 'video/webm;codecs=vp9' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm';
        }

        mediaRecorder = new MediaRecorder(stream, options);
        recordedChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) recordedChunks.push(event.data);
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
        alert('Ekran paylaşımı başlatılamadı!');
    }
}

function stopScreenRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        recordScreenBtn.classList.remove('hidden');
        stopRecordBtn.classList.add('hidden');
        addSystemMessage('Ekran kaydı durduruldu');
    }
}

if (sendFileBtn) sendFileBtn.addEventListener('click', () => fileInput.click());
if (fileInput) fileInput.addEventListener('change', handleFileSelect);

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
        alert('Dosya boyutu 50MB\'dan küçük olmalıdır!');
        return;
    }
    sendFileToAll(file);
    event.target.value = '';
}

function sendFileToAll(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const arrayBuffer = e.target.result;
        const metadata = { name: file.name, size: file.size, type: file.type };

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

        addSystemMessage(`Dosya gönderiliyor: ${file.name}`);
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

if (saveChatBtn) saveChatBtn.addEventListener('click', saveChatHistory);
if (clearChatBtn) clearChatBtn.addEventListener('click', clearChatHistory);

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

    const chatData = { roomId, date: new Date().toISOString(), messages };
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
    if (confirm('Tüm chat geçmişini silmek istediğinizden emin misiniz?')) {
        chatMessages.innerHTML = '';
        addSystemMessage('Chat geçmişi temizlendi');
    }
}

if (bgEffectBtn) bgEffectBtn.addEventListener('click', () => bgEffectMenu.classList.toggle('hidden'));

if (bgEffectMenu) {
    document.querySelectorAll('.bg-option').forEach(option => {
        option.addEventListener('click', function() {
            applyBackgroundEffect(this.dataset.effect);
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
    const effectNames = { 'none': 'Yok', 'blur': 'Blur', 'dark': 'Karanlık', 'light': 'Aydınlık', 'grayscale': 'Siyah-Beyaz' };
    addSystemMessage(`Arka plan efekti: ${effectNames[effect]}`);
}

document.addEventListener('click', (e) => {
    if (bgEffectMenu && !bgEffectMenu.contains(e.target) && e.target !== bgEffectBtn) {
        bgEffectMenu.classList.add('hidden');
    }
});

function enhanceCreatePeerConnection(userId, userName, avatar, isInitiator) {
    const peer = peers.get(userId);
    if (peer && peer.connection) {
        peer.connection.ondatachannel = (event) => {
            peer.dataChannel = event.channel;
            setupDataChannel(event.channel, userId);
        };
    }
}
