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
  const roomList = Array.from(rooms.entries()).map(([roomId, users]) => ({
    roomId,
    userCount: users.size,
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
      rooms.set(roomId, new Map());
    }

    const room = rooms.get(roomId);

    // Maksimum kullanıcı kontrolü
    if (room.size >= MAX_ROOM_SIZE) {
      socket.emit('room-full');
      return;
    }

    // Kullanıcıyı odaya ekle
    socket.join(roomId);
    room.set(socket.id, {
      id: socket.id,
      name: userName || `User-${socket.id.substr(0, 4)}`,
      avatar: avatar || '👤',
      hasCamera: false,
      hasScreen: false,
      handRaised: false
    });

    // Mevcut kullanıcılara bildir
    socket.to(roomId).emit('user-connected', {
      userId: socket.id,
      userName: room.get(socket.id).name,
      avatar: room.get(socket.id).avatar
    });

    // Yeni kullanıcıya mevcut kullanıcıları gönder
    const existingUsers = Array.from(room.values()).filter(u => u.id !== socket.id);
    socket.emit('existing-users', existingUsers);

    console.log(`${userName} (${socket.id}) joined room ${roomId}. Total users: ${room.size}`);
  });

  // WebRTC sinyalleme
  socket.on('offer', ({ targetId, offer, streamType }) => {
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
    if (room && room.has(socket.id)) {
      const user = room.get(socket.id);
      io.to(roomId).emit('chat-message', {
        userId: socket.id,
        userName: user.name,
        avatar: user.avatar,
        message,
        type: type || 'text', // 'text', 'emoji', 'sticker'
        timestamp: new Date().toISOString()
      });
    }
  });

  // El kaldırma
  socket.on('raise-hand', ({ roomId, raised }) => {
    const room = rooms.get(roomId);
    if (room && room.has(socket.id)) {
      const user = room.get(socket.id);
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
    if (room && room.has(socket.id)) {
      const user = room.get(socket.id);
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
    if (room && room.has(socket.id)) {
      const user = room.get(socket.id);
      user.hasCamera = hasCamera;
      user.hasScreen = hasScreen;
      
      socket.to(roomId).emit('user-stream-status', {
        userId: socket.id,
        hasCamera,
        hasScreen
      });
    }
  });

  // Bağlantı kopma
  socket.on('disconnect', () => {
    console.log('Kullanıcı ayrıldı:', socket.id);

    // Tüm odalardan kullanıcıyı çıkar
    rooms.forEach((room, roomId) => {
      if (room.has(socket.id)) {
        room.delete(socket.id);
        socket.to(roomId).emit('user-disconnected', socket.id);

        // Oda boşsa sil
        if (room.size === 0) {
          rooms.delete(roomId);
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
