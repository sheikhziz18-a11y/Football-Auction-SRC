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
app.use(express.json());

// Send index.html on GET /
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Load players DB
let playersPool = [];
try {
  playersPool = JSON.parse(fs.readFileSync(path.join(__dirname, 'players.json'), 'utf8'));
} catch (e) {
  // fallback sample players
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
function pickPlayerForPosition(roomState, pos) {
  const available = playersPool.filter(p => p.position === pos && !roomState.soldPlayers.has(p.name));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// In-memory rooms
const rooms = {};

// Helper functions
function sanitizeRoom(room) {
  const players = Object.values(room.players).map(p => ({
    id: p.id,
    username: p.username,
    balance: p.balance,
    team: p.team
  }));
  return {
    id: room.id,
    capacity: room.capacity,
    players,
    phase: room.phase,
    host: room.host,
    currentAuction: room.currentAuction ? publicAuction(room.currentAuction, room) : null
  };
}

function publicAuction(auction, room) {
  return {
    position: auction.position,
    player: auction.player,
    basePrice: auction.basePrice,
    currentBid: auction.currentBid,
    highestBidder: auction.highestBidder ? room.players[auction.highestBidder]?.username : null,
    biddersCount: auction.biddersCount,
    timeLeft: auction.timeLeft || 0
  };
}

function getStep(value) {
  return value >= 200 ? 10 : 5;
}

// Core auction logic
function startNextAuction(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  for (const p of Object.values(room.players)) p.skipped = false;

  const positions = Array.from(new Set(playersPool.map(p => p.position)));
  const pos = positions[Math.floor(Math.random() * positions.length)];
  const picked = pickPlayerForPosition(room, pos);

  if (!picked) {
    io.to(roomId).emit('chat', { msg: `No more players for position ${pos}. Skipping.` });
    setTimeout(() => startNextAuction(roomId), 500);
    return;
  }

  const auction = {
    position: pos,
    player: picked,
    basePrice: picked.basePrice,
    currentBid: picked.basePrice,
    highestBidder: null,
    biddersCount: 0,
    timeLeft: 45,
    initialTimer: null,
    postBidTimer: null
  };

  room.currentAuction = auction;
  io.to(roomId).emit('auctionStart', publicAuction(auction, room));

  let ticks = 45;
  auction.initialTimer = setInterval(() => {
    ticks--;
    auction.timeLeft = ticks;
    io.to(roomId).emit('auctionTick', { timeLeft: ticks });
    if (ticks <= 0) {
      clearInterval(auction.initialTimer);
      auction.initialTimer = null;
      if (auction.highestBidder === null) {
        io.to(roomId).emit('chat', { msg: 'No bids. Item skipped.' });
        room.soldPlayers.add(auction.player.name);
        room.currentAuction = null;
        setTimeout(() => startNextAuction(roomId), 1500);
      } else {
        auction.postBidTimer = setTimeout(() => finalizeAuction(roomId), 20 * 1000);
        io.to(roomId).emit('chat', { msg: 'Bidding paused. Finalizing in 20s...' });
      }
    }
  }, 1000);
}

function finalizeAuction(roomId) {
  const room = rooms[roomId];
  if (!room || !room.currentAuction) return;
  const auction = room.currentAuction;

  if (auction.initialTimer) clearInterval(auction.initialTimer);
  if (auction.postBidTimer) clearTimeout(auction.postBidTimer);

  if (auction.highestBidder) {
    const winner = room.players[auction.highestBidder];
    const price = auction.currentBid;
    if (winner.balance >= price && winner.team.length < 11) {
      winner.balance -= price;
      winner.team.push({ name: auction.player.name, price });
      room.soldPlayers.add(auction.player.name);
      io.to(roomId).emit('chat', { msg: `${winner.username} won ${auction.player.name} for ${price}M` });
      io.to(roomId).emit('roomUpdate', sanitizeRoom(room));
    } else {
      io.to(roomId).emit('chat', { msg: `Could not finalize sale to ${winner.username} (insufficient funds or team full).` });
    }
  } else {
    io.to(roomId).emit('chat', { msg: 'No winner this round.' });
  }

  room.currentAuction = null;
  setTimeout(() => startNextAuction(roomId), 1500);
}

// Socket.IO events
io.on('connection', socket => {
  console.log('connected:', socket.id);

  // Create room
  socket.on('createRoom', ({ roomId, capacity, username }, cb) => {
    if (rooms[roomId]) return cb({ ok: false, msg: 'Room exists' });
    if (capacity < 3 || capacity > 6) return cb({ ok: false, msg: '3-6 only' });

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

    cb({ ok: true });
    io.to(roomId).emit('roomUpdate', sanitizeRoom(rooms[roomId]));
  });

  // Join room
  socket.on('joinRoom', ({ roomId, username }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, msg: 'Room not found' });
    if (Object.keys(room.players).length >= room.capacity) return cb({ ok: false, msg: 'Room full' });

    socket.join(roomId);
    const player = { id: socket.id, username, balance: 1000, team: [], skipped: false };
    room.players[socket.id] = player;
    room.order.push(socket.id);

    cb({ ok: true });
    io.to(roomId).emit('roomUpdate', sanitizeRoom(room));
  });

  // Start game
  socket.on('startGame', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.host) return;
    if (Object.keys(room.players).length < 2) return; // at least 2 players
    room.phase = 'running';
    io.to(roomId).emit('roomUpdate', sanitizeRoom(room));
    startNextAuction(roomId);
  });

  // Bid
  socket.on('bid', ({ roomId, amount }, cb) => {
    const room = rooms[roomId];
    if (!room || !room.currentAuction) return cb({ ok: false, msg: 'No auction' });
    const auction = room.currentAuction;
    const player = room.players[socket.id];
    if (!player) return cb({ ok: false, msg: 'Not in room' });
    if (player.skipped) return cb({ ok: false, msg: 'You skipped this round' });
    if (player.team.length >= 11) return cb({ ok: false, msg: 'Max 11 players' });

    const step = getStep(auction.currentBid);
    if (auction.highestBidder === null) {
      if (amount !== auction.basePrice && amount !== auction.basePrice + step)
        return cb({ ok: false, msg: 'First bid must be basePrice or basePrice+step' });
    } else {
      if (amount < auction.currentBid + step) return cb({ ok: false, msg: `Bid must be at least ${auction.currentBid + step}M` });
    }
    if (amount > player.balance) return cb({ ok: false, msg: 'Insufficient balance' });

    auction.currentBid = amount;
    auction.highestBidder = socket.id;

    if (auction.postBidTimer) clearTimeout(auction.postBidTimer);
    auction.postBidTimer = setTimeout(() => finalizeAuction(roomId), 20 * 1000);

    io.to(roomId).emit('auctionUpdate', publicAuction(auction, room));
    cb({ ok: true });
  });

  // Skip
  socket.on('skip', ({ roomId }, cb) => {
    const room = rooms[roomId];
    if (!room || !room.currentAuction) return cb({ ok: false });
    const player = room.players[socket.id];
    if (!player) return cb({ ok: false });
    player.skipped = true;
    io.to(roomId).emit('chat', { msg: `${player.username} skipped.` });
    cb({ ok: true });
  });

  // Request room
  socket.on('requestRoom', (roomId, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false });
    cb({ ok: true, room: sanitizeRoom(room) });
  });

  // Disconnect
  socket.on('disconnect', () => {
    for (const rId of Object.keys(rooms)) {
      const room = rooms[rId];
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        room.order = room.order.filter(id => id !== socket.id);
        io.to(rId).emit('roomUpdate', sanitizeRoom(room));
      }
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
