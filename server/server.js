const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// CORS ayarları
app.use(cors());
app.use(express.json());

// Socket.IO yapılandırması
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Oda yönetimi
const rooms = new Map();
const MAX_ROOM_SIZE = 50;

// Static dosyaları sun
app.use(express.static(path.join(__dirname, '../client')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Oda bilgilerini getir
app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.entries()).map(([roomId, room]) => ({
    roomId,
    userCount: room.users.size,
    maxUsers: MAX_ROOM_SIZE
  }));
  res.json(roomList);
});

io.on('connection', (socket) => {
  console.log('Yeni kullanıcı bağlandı:', socket.id);

  // Odaya katıl
  socket.on('join-room', ({ roomId, userName, avatar }) => {
    // Oda kontrolü
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Map(),
        adminId: socket.id, // İlk giren admin
        joinOrder: [socket.id], // Giriş sırası
        currentBackground: null // { userId: string, type: 'camera' | 'screen' }
      });
      console.log(`🏰 Yeni oda oluşturuldu: ${roomId}, Admin: ${socket.id}`);
    }

    const room = rooms.get(roomId);

    // Maksimum kullanıcı kontrolü
    if (room.users.size >= MAX_ROOM_SIZE) {
      socket.emit('room-full');
      return;
    }

    // Kullanıcıyı odaya ekle
    socket.join(roomId);
    
    const isAdmin = room.adminId === socket.id;
    room.users.set(socket.id, {
      id: socket.id,
      name: userName || `User-${socket.id.substr(0, 4)}`,
      avatar: avatar || '👤',
      hasCamera: false,
      hasScreen: false,
      handRaised: false,
      isSharingScreen: false,
      currentStreamType: 'camera', // 🆕 'camera' veya 'screen'
      isAdmin: isAdmin,
      joinedAt: Date.now()
    });
    
    // Giriş sırasına ekle (eğer yoksa)
    if (!room.joinOrder.includes(socket.id)) {
      room.joinOrder.push(socket.id);
    }

    console.log(`👤 ${userName} (${socket.id}) katıldı. Admin: ${isAdmin ? 'EVET 👑' : 'Hayır'}`);

    // Mevcut kullanıcılara bildir
    socket.to(roomId).emit('user-connected', {
      userId: socket.id,
      userName: room.users.get(socket.id).name,
      avatar: room.users.get(socket.id).avatar,
      isAdmin: isAdmin
    });

    // Yeni kullanıcıya mevcut kullanıcıları, admin bilgisini VE mevcut arka plan durumunu gönder
    const existingUsers = Array.from(room.users.values()).filter(u => u.id !== socket.id);
    socket.emit('existing-users', {
      users: existingUsers,
      adminId: room.adminId,
      currentBackground: room.currentBackground // 🆕 Mevcut arka plan durumu
    });

    // Odadaki herkese admin bilgisini güncelle
    io.to(roomId).emit('admin-updated', {
      adminId: room.adminId
    });

    console.log(`Oda ${roomId} - Toplam kullanıcı: ${room.users.size}, Admin: ${room.adminId}`);
    
    // Eğer mevcut bir arka plan varsa, yeni kullanıcıya göster
    if (room.currentBackground) {
      console.log(`📺 Yeni kullanıcıya mevcut arka plan gösteriliyor:`, room.currentBackground);
    }
  });

  // 🆕 YENİ: Yeni kullanıcı peer bağlantılarını tamamladığında bildirim gönderir
  socket.on('peers-ready', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    console.log(`✅ ${socket.id} peer bağlantıları hazır`);

    // Eğer bir arka plan varsa, şimdi bu kullanıcıya aktif arka planı göster
    if (room.currentBackground) {
      const { userId, type } = room.currentBackground;
      console.log(`🔄 Peer hazır olduğu için arka plan tekrar gönderiliyor:`, { userId, type });
      
      // Yeni kullanıcıya özel olarak arka plan göster
      if (type === 'camera') {
        socket.emit('camera-background-shown', { userId });
      } else if (type === 'screen') {
        socket.emit('screen-background-shown', { userId });
      }
    }
  });

  // WebRTC sinyalleme
  socket.on('offer', async ({ targetId, offer, streamType }) => {
    io.to(targetId).emit('offer', {
      senderId: socket.id,
      offer,
      streamType
    });
  });

  socket.on('answer', ({ targetId, answer }) => {
    io.to(targetId).emit('answer', {
      senderId: socket.id,
      answer
    });
  });

  socket.on('ice-candidate', ({ targetId, candidate }) => {
    io.to(targetId).emit('ice-candidate', {
      senderId: socket.id,
      candidate
    });
  });

  // Chat mesajı
  socket.on('chat-message', ({ roomId, message, type }) => {
    const room = rooms.get(roomId);
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      io.to(roomId).emit('chat-message', {
        userId: socket.id,
        userName: user.name,
        avatar: user.avatar,
        message,
        type: type || 'text',
        timestamp: new Date().toISOString()
      });
    }
  });

  // El kaldırma
  socket.on('raise-hand', ({ roomId, raised }) => {
    const room = rooms.get(roomId);
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      user.handRaised = raised;
      
      io.to(roomId).emit('hand-raised', {
        userId: socket.id,
        userName: user.name,
        raised
      });
    }
  });

  // Emoji reaksiyonu
  socket.on('send-reaction', ({ roomId, emoji }) => {
    const room = rooms.get(roomId);
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      socket.to(roomId).emit('reaction-received', {
        userId: socket.id,
        userName: user.name,
        emoji
      });
    }
  });

  // Stream durumu güncelleme
  socket.on('update-stream-status', ({ roomId, hasCamera, hasScreen }) => {
    const room = rooms.get(roomId);
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      user.hasCamera = hasCamera;
      user.hasScreen = hasScreen;
      
      socket.to(roomId).emit('user-stream-status', {
        userId: socket.id,
        hasCamera,
        hasScreen
      });
    }
  });

  // 🆕 EKRAN PAYLAŞIMI BAŞLADI
  socket.on('screen-share-started', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      user.isSharingScreen = true;
      user.currentStreamType = 'screen'; // 🆕 Stream türünü güncelle
      
      // TÜM KULLANICILARA BİLDİR (kendi dahil)
      io.to(roomId).emit('user-screen-share-started', {
        userId: socket.id,
        userName: user.name
      });
      
      console.log(`🖥️ ${user.name} ekran paylaşımı başlattı - currentStreamType: screen`);
      
      // 🆕 Yeni katılanlara bilgi vermek için odadaki herkese stream türünü bildir
      io.to(roomId).emit('user-stream-type-changed', {
        userId: socket.id,
        streamType: 'screen'
      });
    }
  });

  // 🆕 EKRAN PAYLAŞIMI DURDU
  socket.on('screen-share-stopped', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      user.isSharingScreen = false;
      user.currentStreamType = 'camera'; // 🆕 Stream türünü güncelle
      
      // TÜM KULLANICILARA BİLDİR (kendi dahil)
      io.to(roomId).emit('user-screen-share-stopped', {
        userId: socket.id,
        userName: user.name
      });
      
      console.log(`🛑 ${user.name} ekran paylaşımını durdurdu - currentStreamType: camera`);
      
      // 🆕 Yeni katılanlara bilgi vermek için odadaki herkese stream türünü bildir
      io.to(roomId).emit('user-stream-type-changed', {
        userId: socket.id,
        streamType: 'camera'
      });
    }
  });

  // 🖥️ Admin ekran paylaşımını arka plana getirdi
  socket.on('show-screen-background', ({ roomId, targetUserId }) => {
    const room = rooms.get(roomId);
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      
      // Sadece admin yapabilir
      if (user.isAdmin) {
        // Arka plan durumunu kaydet
        room.currentBackground = {
          userId: targetUserId,
          type: 'screen'
        };
        
        io.to(roomId).emit('screen-background-shown', {
          userId: targetUserId
        });
        console.log(`🖥️ Admin ${user.name}, ${targetUserId}'nin ekranını arka plana getirdi`);
      }
    }
  });

  // 📹 Admin kamerayı arka plana getirdi
  socket.on('show-camera-background', ({ roomId, targetUserId }) => {
    const room = rooms.get(roomId);
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      
      // Sadece admin yapabilir
      if (user.isAdmin) {
        // Arka plan durumunu kaydet
        room.currentBackground = {
          userId: targetUserId,
          type: 'camera'
        };
        
        io.to(roomId).emit('camera-background-shown', {
          userId: targetUserId
        });
        console.log(`📹 Admin ${user.name}, ${targetUserId}'nin kamerasını arka plana getirdi`);
      }
    }
  });

  // 🚫 Admin arka plan görüntüsünü kapattı
  socket.on('hide-background', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      
      // Sadece admin yapabilir
      if (user.isAdmin) {
        // Arka plan durumunu temizle
        room.currentBackground = null;
        
        io.to(roomId).emit('background-hidden');
        console.log(`🚫 Admin ${user.name} arka plan görüntüsünü kapattı`);
      }
    }
  });

  // Bağlantı kopma
  socket.on('disconnect', () => {
    console.log('Kullanıcı ayrıldı:', socket.id);

    // Tüm odalardan kullanıcıyı çıkar
    rooms.forEach((room, roomId) => {
      if (room.users.has(socket.id)) {
        const wasAdmin = room.adminId === socket.id;
        const user = room.users.get(socket.id);
        
        room.users.delete(socket.id);
        
        // Giriş sırasından çıkar
        const index = room.joinOrder.indexOf(socket.id);
        if (index > -1) {
          room.joinOrder.splice(index, 1);
        }
        
        socket.to(roomId).emit('user-disconnected', socket.id);
        
        // Eğer arka planda bu kullanıcı gösteriliyorsa, arka planı kapat
        if (room.currentBackground && room.currentBackground.userId === socket.id) {
          room.currentBackground = null;
          io.to(roomId).emit('background-hidden');
          console.log(`🚫 Ayrılan kullanıcının arka planı kapatıldı`);
        }

        // Eğer admin ayrıldıysa, yeni admin ata
        if (wasAdmin && room.users.size > 0) {
          // Giriş sırasına göre bir sonraki kullanıcıyı admin yap
          let newAdminId = null;
          for (const userId of room.joinOrder) {
            if (room.users.has(userId)) {
              newAdminId = userId;
              break;
            }
          }
          
          if (newAdminId) {
            room.adminId = newAdminId;
            const newAdmin = room.users.get(newAdminId);
            newAdmin.isAdmin = true;
            
            console.log(`👑 Yeni admin: ${newAdmin.name} (${newAdminId})`);
            
            // Tüm kullanıcılara yeni admin bilgisini gönder
            io.to(roomId).emit('admin-updated', {
              adminId: newAdminId,
              oldAdminName: user.name,
              newAdminName: newAdmin.name
            });
          }
        }

        // Oda boşsa sil
        if (room.users.size === 0) {
          rooms.delete(roomId);
          console.log(`🗑️ Oda silindi: ${roomId}`);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server çalışıyor: http://localhost:${PORT}`);
  console.log(`📹 WebRTC Video Chat hazır!`);
});
