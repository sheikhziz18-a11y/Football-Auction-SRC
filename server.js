// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static public folder
app.use(express.static(path.join(__dirname, 'public')));

// Send index.html on GET /
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.json());

// Load players DB
let playersPool = [];
try {
  playersPool = JSON.parse(fs.readFileSync(path.join(__dirname, 'players.json'), 'utf8'));
} catch (e) {
  playersPool = [
    { name: "Luka Modric", position: "CM", basePrice: 50 },
    { name: "Cristiano Ronaldo", position: "CF", basePrice: 70 },
    { name: "Manuel Neuer", position: "GK", basePrice: 40 },
    { name: "Virgil van Dijk", position: "CB", basePrice: 55 },
    { name: "Mohamed Salah", position: "RW", basePrice: 60 },
    { name: "Kylian Mbappé", position: "CF", basePrice: 80 },
  ];
}

// Utility: pick random player by position
function pickPlayerForPosition(roomState, pos){
  const available = playersPool.filter(p => p.position === pos && !roomState.soldPlayers.has(p.name));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// In-memory rooms
const rooms = {};

io.on('connection', socket => {
  console.log('connected:', socket.id);

  socket.on('createRoom', ({roomId, capacity, username}, cb) => {
    if (rooms[roomId]) return cb({ ok:false, msg:'Room exists' });
    if (capacity < 3 || capacity > 6) return cb({ ok:false, msg:'3-6 only' });

    rooms[roomId] = {
      id: roomId,
      capacity,
      players: {},
      order: [],
      host: socket.id,
      phase: 'lobby',
      soldPlayers: new Set(),
      currentAuction: null
    };

    socket.join(roomId);
    const player = { id: socket.id, username, balance: 1000, team: [], skipped: false };
    rooms[roomId].players[socket.id] = player;
    rooms[roomId].order.push(socket.id);

    cb({ ok:true });
    io.to(roomId).emit('roomUpdate', rooms[roomId]);
  });

  socket.on('joinRoom', ({roomId, username}, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok:false, msg:'Not found' });
    if (Object.keys(room.players).length >= room.capacity) return cb({ ok:false, msg:'Full' });

    socket.join(roomId);
    const player = { id: socket.id, username, balance: 1000, team: [], skipped: false };
    room.players[socket.id] = player;
    room.order.push(socket.id);

    cb({ ok:true });
    io.to(roomId).emit('roomUpdate', room);
  });

});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
