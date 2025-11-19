// public/script.js
const socket = io();

let myId = null;
let currentRoom = null;
let isHost = false;

const el = id => document.getElementById(id);

// UI elements
const usernameEl = el('username');
const roomEl = el('roomId');
const createBtn = el('createBtn');
const joinBtn = el('joinBtn');
const capacityEl = el('capacity');
const statusEl = el('status');
const lobbyDiv = el('lobby');
const gameDiv = el('game');
const playersList = el('playersList');
const roomTitle = el('roomTitle');
const hostControls = el('hostControls');
const chatLog = el('chatLog');
const wheel = el('wheel');
const spinOverlay = el('spinOverlay');
const positionText = el('positionText');
const playerCard = el('playerCard');
const priceInfo = el('priceInfo');
const auctionTimers = el('auctionTimers');
const bidBtn = el('bidBtn');
const skipBtn = el('skipBtn');
const bidNote = el('bidNote');

createBtn.onclick = () => {
  const username = usernameEl.value.trim() || 'You';
  const roomId = (roomEl.value.trim() || 'room') + '_' + Math.floor(Math.random()*1000);
  socket.emit('createRoom', {roomId, capacity: parseInt(capacityEl.value,10), username}, (res)=>{
    if(res.ok){
      statusEl.textContent = `Created ${roomId}`;
      enterRoom(roomId, username, true);
    } else statusEl.textContent = res.msg;
  });
};

joinBtn.onclick = () => {
  const username = usernameEl.value.trim() || 'You';
  const roomId = roomEl.value.trim();
  if(!roomId){ statusEl.textContent = 'Enter room id.'; return; }
  socket.emit('joinRoom', {roomId, username}, (res)=>{
    if(res.ok){
      statusEl.textContent = `Joined ${roomId}`;
      enterRoom(roomId, username, false);
    } else statusEl.textContent = res.msg;
  });
};

function enterRoom(roomId, username, host){
  myId = null; // will set on first update
  currentRoom = roomId;
  isHost = host;
  lobbyDiv.style.display = 'none';
  gameDiv.style.display = 'flex';
  roomTitle.textContent = `Room: ${roomId}`;
  hostControls.innerHTML = '';
  if(host){
    const btn = document.createElement('button');
    btn.textContent = 'Start Game';
    btn.onclick = ()=> socket.emit('startGame', {roomId});
    hostControls.appendChild(btn);
  }
  // request full room
  socket.emit('requestRoom', roomId, (res)=>{
    if(res.ok) updateRoom(res.room);
  });
}

// socket events
socket.on('connect', ()=> myId = socket.id);
socket.on('roomUpdate', data => updateRoom(data));
socket.on('roomUpdate', data => updateRoom(data));
socket.on('chat', msg => {
  appendLog(msg.msg || JSON.stringify(msg));
});
socket.on('auctionStart', auction => {
  startSpinAnimation(auction.position);
  setTimeout(()=> {
    showAuction(auction);
  }, 2500); // coincide with spin
});
socket.on('auctionUpdate', auction => {
  showAuction(auction);
});
socket.on('auctionTick', ({timeLeft}) => {
  auctionTimers.textContent = `Time: ${timeLeft}s`;
});
socket.on('auctionStart', a => console.log('auctionStart', a));

function updateRoom(room){
  // find us
  currentRoom = room.id;
  const me = room.players.find(p => p.id === socket.id);
  isHost = room.host === socket.id;
  // players
  playersList.innerHTML = '';
  room.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'playerItem';
    div.innerHTML = `<div>${p.username} (${p.team.length}/11)</div><div>${p.balance}M</div>`;
    if(p.id === socket.id) div.style.fontWeight = '700';
    playersList.appendChild(div);
  });
  // auction display
  if(room.currentAuction){
    showAuction(room.currentAuction);
  }
}

function startSpinAnimation(position){
  positionText.textContent = '';
  playerCard.textContent = '';
  priceInfo.textContent = '';
  spinOverlay.style.display = 'block';
  // rotate wheel randomly between 900 and 1800 deg
  const deg = Math.floor(900 + Math.random()*900);
  wheel.style.transform = `rotate(${deg}deg)`;
  setTimeout(()=> {
    spinOverlay.style.display = 'none';
    wheel.style.transform = `rotate(${deg % 360}deg)`;
    positionText.textContent = `Position: ${position}`;
  }, 2500);
}

function showAuction(auction){
  if(!auction) return;
  positionText.textContent = `Position: ${auction.position}`;
  playerCard.innerHTML = `<strong>${auction.player.name}</strong>`;
  priceInfo.textContent = `Base: ${auction.basePrice}M · Current: ${auction.currentBid}M · Highest: ${auction.highestBidder || '-'}`;
  auctionTimers.textContent = `Time left: ${auction.timeLeft || 0}s`;
  bidNote.textContent = `Bids: steps of 5M until 200M, then 10M`;
  // enable controls
  bidBtn.disabled = false;
  skipBtn.disabled = false;
  bidBtn.onclick = ()=> doBid(auction);
  skipBtn.onclick = ()=> {
    socket.emit('skip', {roomId: currentRoom}, (res)=>{ if(!res.ok) appendLog(res.msg) });
  };
}

function doBid(auction){
  // compute suggested next bid
  const me = null; // not used locally for validation
  let next;
  if(!auction.highestBidder){
    // first bid: allow basePrice or base+step. We'll propose basePrice.
    next = auction.basePrice;
  } else {
    const step = auction.currentBid >= 200 ? 10 : 5;
    next = auction.currentBid + step;
  }
  const ok = confirm(`Place bid ${next}M ?`);
  if(!ok) return;
  socket.emit('bid', {roomId: currentRoom, amount: next}, (res)=>{
    if(!res.ok) appendLog('Bid failed: ' + res.msg);
  });
}

function appendLog(txt){
  const d = document.createElement('div');
  d.textContent = txt;
  chatLog.appendChild(d);
  chatLog.scrollTop = chatLog.scrollHeight;
}
