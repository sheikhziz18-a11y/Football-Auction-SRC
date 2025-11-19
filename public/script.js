const socket = io();
let myId=null, currentRoom=null, isHost=false;

const el=id=>document.getElementById(id);

// UI elements
const usernameEl=el('username');
const roomEl=el('roomId');
const createBtn=el('createBtn');
const joinBtn=el('joinBtn');
const capacityEl=el('capacity');
const statusEl=el('status');
const lobbyDiv=el('lobby');
const gameDiv=el('game');
const playersList=el('playersList');
const roomTitle=el('roomTitle');
const hostControls=el('hostControls');
const chatLog=el('chatLog');
const wheel=el('wheel');
const spinOverlay=el('spinOverlay');
const positionText=el('positionText');
const playerCard=el('playerCard');
const priceInfo=el('priceInfo');
const auctionTimers=el('auctionTimers');
const bidBtn=el('bidBtn');
const skipBtn=el('skipBtn');
const bidNote=el('bidNote');

createBtn.onclick=()=>{
  const username=usernameEl.value.trim()||'You';
  const roomId=(roomEl.value.trim()||'room')+'_'+Math.floor(Math.random()*1000);
  socket.emit('createRoom',{roomId,capacity:parseInt(capacityEl.value,10),username},res=>{
    if(res.ok){statusEl.textContent=`Created ${roomId}`; enterRoom(roomId,username,true);}
    else statusEl.textContent=res.msg;
  });
};

joinBtn.onclick=()=>{
  const username=usernameEl.value.trim()||'You';
  const roomId=roomEl.value.trim();
  if(!roomId){statusEl.textContent='Enter room id.'; return;}
  socket.emit('joinRoom',{roomId,username},res=>{
    if(res.ok){statusEl.textContent=`Joined ${roomId}`; enterRoom(roomId,username,false);}
    else statusEl.textContent=res.msg;
  });
};

function enterRoom(roomId, username, host){
  myId=null; currentRoom=roomId; isHost=host;
  lobbyDiv.style.display='none';
  gameDiv.style.display='flex';
  roomTitle.textContent=`Room: ${roomId}`;
  hostControls.innerHTML='';
  if(host){
    const startBtn=document.createElement('button');
    startBtn.textContent='Start Game';
    startBtn.onclick=()=>socket.emit('startGame',{roomId});
    hostControls.appendChild(startBtn);
  }
  socket.emit('requestRoom', roomId,res=>{if(res.ok) updateRoom(res.room)});
}

socket.on('connect',()=>myId=socket.id);
socket.on('roomUpdate',updateRoom);
socket.on('chat',msg=>appendLog(msg.msg||JSON.stringify(msg)));
socket.on('auctionReady',auction=>{
  spinOverlay.style.display='block';
  positionText.textContent='';
  playerCard.textContent='';
  priceInfo.textContent='';
  if(isHost){
    const btn=document.createElement('button');
    btn.textContent='Spin Wheel';
    btn.onclick=()=>{socket.emit('spinWheel',{roomId:currentRoom}); btn.disabled=true;}
    hostControls.appendChild(btn);
  }
});
socket.on('auctionStart',auction=>{
  spinOverlay.style.display='none';
  positionText.textContent=`Position: ${auction.position}`;
  playerCard.innerHTML=`<strong>${auction.player.name}</strong>`;
  priceInfo.textContent=`Base: ${auction.basePrice}M · Current: ${auction.currentBid}M · Highest: ${auction.highestBidder||'-'}`;
  auctionTimers.textContent=`Time left: ${auction.timeLeft||0}s`;
  bidNote.textContent='Bids: steps of 5M until 200M, then 10M';
  bidBtn.disabled=false; skipBtn.disabled=false;
  bidBtn.onclick=()=>doBid(auction);
  skipBtn.onclick=()=>socket.emit('skip',{roomId:currentRoom},res=>{if(!res.ok)appendLog(res.msg)});
});
socket.on('auctionUpdate',auction=>{
  playerCard.innerHTML=`<strong>${auction.player.name}</strong>`;
  priceInfo.textContent=`Base: ${auction.basePrice}M · Current: ${auction.currentBid}M · Highest: ${auction.highestBidder||'-'}`;
});
socket.on('auctionTick',({timeLeft})=>auctionTimers.textContent=`Time: ${timeLeft}s`);

function updateRoom(room){
  currentRoom=room.id; isHost=room.host===socket.id;
  playersList.innerHTML='';
  room.players.forEach(p=>{
    const div=document.createElement('div');
    div.className='playerItem';
    div.innerHTML=`<div>${p.username} (${p.team.length}/11)</div><div>${p.balance}M</div>`;
    if(p.id===socket.id) div.style.fontWeight='700';
    playersList.appendChild(div);
  });
  if(room.currentAuction){} // auction handled by auctionStart/update
}

function doBid(auction){
  let next;
  if(!auction.highestBidder) next=auction.basePrice;
  else{const step=auction.currentBid>=200?10:5; next=auction.currentBid+step;}
  const ok=confirm(`Place bid ${next}M ?`); if(!ok) return;
  socket.emit('bid',{roomId:currentRoom,amount:next},res=>{if(!res.ok) appendLog('Bid failed: '+res.msg)});
}

function appendLog(txt){const d=document.createElement('div');d.textContent=txt;chatLog.appendChild(d);chatLog.scrollTop=chatLog.scrollHeight;}
