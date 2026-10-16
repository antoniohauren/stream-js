'use strict';
const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['name','roomTitle','joinForm','joinPanel','share','heroShare','stop','leave','invite','quality','qualityBadge','shareAudio','screen','empty','notice','members','count','connection','dot','roomLabel','stageStatus','liveDot','audioStatus','enableSound','sidebar','toggleSidebar'].map(id => [id,$(id)]));
const roomNames = ['room-1','room-2','room-3'];
const linkedRoom = new URLSearchParams(location.hash.slice(1)).get('room');
let selectedRoom = roomNames.includes(linkedRoom) ? linkedRoom : roomNames[0];
let ws, me, presenter, capture, outgoing, heartbeat, starting = false, captureEpoch = 0;
const members = new Map(), peers = new Map();
let roomIceServers = [{urls:'stun:stun.l.google.com:19302'}], roomIcePolicy = 'all';
ui.name.value = localStorage.getItem('streamroom-name') || '';
const say = text => ui.notice.textContent = text;
const send = data => { if(ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
function renderMembers(){ ui.members.replaceChildren(); ui.count.textContent = members.size; for(const [id,name] of members){ const row=document.createElement('div');row.className='member';const avatar=document.createElement('span');avatar.className='avatar';avatar.textContent=name.slice(0,2).toUpperCase();const label=document.createElement('span');label.textContent=name+(id===me?' (you)':'');row.append(avatar,label);if(id===presenter){const live=document.createElement('small');live.textContent='LIVE';row.append(live);}ui.members.append(row); } }
function controls(){ const connected=ws?.readyState===WebSocket.OPEN && !!me; const mine=presenter===me && !!me;ui.share.disabled=ui.heroShare.disabled=!connected||!!presenter||starting;ui.share.hidden=mine;ui.stop.hidden=!mine;ui.quality.disabled=ui.shareAudio.disabled=!!presenter||starting;ui.invite.disabled=!connected;ui.leave.hidden=!connected;ui.joinPanel.hidden=connected; }
function renderRooms(){ui.roomTitle.textContent=selectedRoom;for(const room of roomNames){$(room).classList.toggle('active',room===selectedRoom);$(room).setAttribute('aria-current',String(room===selectedRoom));}}
function selectRoom(room){if(!roomNames.includes(room))return;if(room===selectedRoom&&ws)return;leave();selectedRoom=room;location.hash=new URLSearchParams({room}).toString();renderRooms();join();}
for(const room of roomNames)$(room).onclick=()=>selectRoom(room);
renderRooms();
function closePeers(){ for(const entry of peers.values()) entry.pc.close();peers.clear(); }
function releaseCapture(){ captureEpoch++;for(const stream of [capture,outgoing]) stream?.getTracks().forEach(t=>t.stop()); capture=outgoing=null; }
function resetStage(){closePeers();releaseCapture();ui.screen.srcObject=null;ui.screen.style.display='none';ui.empty.hidden=false;ui.enableSound.hidden=true;ui.stageStatus.textContent='READY WHEN YOU ARE';ui.liveDot.classList.remove('on');ui.audioStatus.textContent='Window or tab audio when supported';presenter=null;starting=false;renderMembers();controls();}
function leave(){ws?.close();ws=null;clearInterval(heartbeat);resetStage();me=null;members.clear();renderMembers();ui.connection.textContent='Not connected';ui.dot.classList.remove('on');ui.roomLabel.textContent='Join a room to get started';controls();}
ui.leave.onclick=()=>{leave();say('You left the room.');};
ui.joinForm.onsubmit=event=>{event.preventDefault();join();};
ui.toggleSidebar.onclick=()=>{ui.sidebar.hidden=!ui.sidebar.hidden;ui.toggleSidebar.textContent=ui.sidebar.hidden?'Show sidebar':'Hide sidebar';ui.toggleSidebar.setAttribute('aria-expanded',String(!ui.sidebar.hidden));};
function join(){const name=ui.name.value.trim()||`Guest-${crypto.randomUUID().slice(0,8)}`;const room=selectedRoom;if([...name].length>32){say('Enter a display name (up to 32 characters).');return;}if(ws)leave();ui.name.value=name;localStorage.setItem('streamroom-name',name);location.hash=new URLSearchParams({room}).toString();say(`Connecting to ${room}…`);const socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/${encodeURIComponent(room)}?name=${encodeURIComponent(name)}`);ws=socket;
socket.onopen=()=>{if(ws!==socket)return;heartbeat=setInterval(()=>send({type:'ping'}),25000);};
let chain=Promise.resolve();socket.onmessage=event=>{chain=chain.then(()=>{if(ws===socket)return receive(JSON.parse(event.data));}).catch(err=>say(`Connection error: ${err.message}`));};
socket.onerror=()=>{if(ws===socket)say('Could not connect. Check that the server is running.');};
socket.onclose=()=>{if(ws===socket){leave();say('Disconnected. Enter the room again to reconnect.');}};
};
async function receive(msg){switch(msg.type){
case 'welcome':roomIceServers=Array.isArray(msg.iceServers)&&msg.iceServers.length?msg.iceServers:[{urls:'stun:stun.l.google.com:19302'}];roomIcePolicy=msg.iceTransportPolicy==='relay'?'relay':'all';me=msg.id;presenter=msg.presenter;members.clear();for(const p of msg.members)members.set(p.id,p.name);ui.connection.textContent='Room connected';ui.dot.classList.add('on');ui.roomLabel.textContent=selectedRoom;if(presenter){ui.stageStatus.textContent=`${members.get(presenter)||'Someone'} IS LIVE`;ui.liveDot.classList.add('on');}controls();say(presenter?'Connecting to the shared screen…':'You’re in. Share your screen whenever you’re ready.');break;
case 'joined':members.set(msg.id,msg.name);renderMembers();if(presenter===me&&msg.id!==me&&outgoing)await offer(msg.id);break;
case 'left':members.delete(msg.id);peers.get(msg.id)?.pc.close();peers.delete(msg.id);renderMembers();break;
case 'started':presenter=msg.id;starting=false;ui.stageStatus.textContent=`${members.get(presenter)||'Someone'} IS LIVE`;ui.liveDot.classList.add('on');controls();renderMembers();if(presenter===me){for(const id of members.keys())if(id!==me)await offer(id);}else say('Connecting to the shared screen…');break;
case 'stopped':resetStage();say('Screen sharing ended.');break;
case 'busy':releaseCapture();starting=false;ui.screen.srcObject=null;ui.screen.style.display='none';ui.empty.hidden=false;controls();say(msg.message);break;
case 'error':say(msg.message);break;
case 'signal':await signal(msg.from,msg.data);break;
}}
function createPeer(id){if(peers.has(id))return peers.get(id);const iceServers=[...roomIceServers];
// Optional TURN configuration is local to this browser. See README.
try{const turn=JSON.parse(localStorage.getItem('streamroom-turn')||'null');if(turn?.urls)iceServers.push(turn);}catch{}
const pc=new RTCPeerConnection({iceServers,iceTransportPolicy:roomIcePolicy});const entry={pc,pending:[]};peers.set(id,entry);
pc.onicecandidate=e=>{if(e.candidate)send({type:'signal',to:id,data:{candidate:e.candidate}});};
pc.ontrack=e=>{ui.screen.srcObject=e.streams[0];ui.screen.muted=false;ui.screen.style.display='block';ui.empty.hidden=true;ui.screen.play().then(()=>{ui.enableSound.hidden=true;}).catch(()=>{ui.enableSound.hidden=false;});ui.audioStatus.textContent=e.streams[0].getAudioTracks().length?'Shared audio connected':'Video connected · no shared audio';say('You’re watching live. Use the video controls for volume or fullscreen.');ui.screen.controls=true;};
pc.onconnectionstatechange=()=>{if(pc.connectionState==='failed')say(iceServers.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(u=>/^turns?:/.test(u)))?'Media connection failed. Check the TURN service and relay firewall ports, then rejoin.':'Direct media connection failed. This network may need a TURN relay; see TURN-AWS.md.');};
return entry;}
async function offer(id){const {pc}=createPeer(id);for(const track of outgoing.getTracks())pc.addTrack(track,outgoing);await pc.setLocalDescription(await pc.createOffer());for(const sender of pc.getSenders()){if(sender.track?.kind==='video'){const p=sender.getParameters();if(p.encodings?.length){p.encodings[0].maxBitrate=ui.quality.value==='1080'?6000000:3000000;p.encodings[0].maxFramerate=30;await sender.setParameters(p);}}}send({type:'signal',to:id,data:{description:pc.localDescription}});}
async function signal(id,data){if(id!==presenter&&presenter!==me)return;const entry=createPeer(id),pc=entry.pc;if(data.description){await pc.setRemoteDescription(data.description);for(const candidate of entry.pending)await pc.addIceCandidate(candidate);entry.pending=[];if(data.description.type==='offer'){await pc.setLocalDescription(await pc.createAnswer());send({type:'signal',to:id,data:{description:pc.localDescription}});}}else if(data.candidate){if(pc.remoteDescription)await pc.addIceCandidate(data.candidate);else entry.pending.push(data.candidate);}}
async function share(){if(starting||presenter||!me)return;if(!navigator.mediaDevices?.getDisplayMedia){say('Screen capture needs Edge or Chrome on localhost or a trusted HTTPS address.');return;}starting=true;controls();const epoch=++captureEpoch;let screenStream,requested=false;
try{const height=Number(ui.quality.value),width=height===1080?1920:1280;screenStream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:width,max:width},height:{ideal:height,max:height},frameRate:{ideal:30,max:30}},audio:ui.shareAudio.checked?{suppressLocalAudioPlayback:false}:false,systemAudio:'exclude',windowAudio:'window',selfBrowserSurface:'exclude',surfaceSwitching:'exclude'});if(epoch!==captureEpoch){screenStream.getTracks().forEach(t=>t.stop());return;}capture=screenStream;
if(!me||ws?.readyState!==WebSocket.OPEN){releaseCapture();return;}
const video=capture.getVideoTracks()[0];await video.applyConstraints({width:{ideal:width,max:width},height:{ideal:height,max:height},frameRate:{ideal:30,max:30}});video.contentHint='detail';
if(epoch!==captureEpoch)return;
if(!me||ws?.readyState!==WebSocket.OPEN){releaseCapture();return;}
outgoing=new MediaStream([video,...capture.getAudioTracks()]);
video.onended=()=>{send({type:'stop'});releaseCapture();};ui.screen.srcObject=outgoing;ui.screen.muted=true;ui.screen.controls=false;ui.screen.style.display='block';ui.empty.hidden=true;await ui.screen.play();if(epoch!==captureEpoch)return;if(video.readyState==='ended')throw new Error('Screen capture ended before sharing started.');const actual=video.getSettings();ui.qualityBadge.textContent=`${actual.width}×${actual.height} / ${Math.round(actual.frameRate||30)} FPS`;ui.audioStatus.textContent=`Shared audio ${capture.getAudioTracks().length?'on':'not selected'}`;say(capture.getAudioTracks().length?'You’re sharing with audio.':'Sharing video without source audio. Select a tab with “Share audio”, or a window if your browser supports window audio.');send({type:'start'});requested=true;
}catch(err){if(epoch!==captureEpoch)return;releaseCapture();starting=false;controls();ui.screen.srcObject=null;ui.screen.style.display='none';ui.empty.hidden=false;say(err.name==='NotAllowedError'?'Sharing was cancelled or permission was denied.':`Could not start sharing: ${err.message}`);}finally{if(epoch===captureEpoch){starting=requested;controls();}}}
ui.share.onclick=ui.heroShare.onclick=share;ui.stop.onclick=()=>{send({type:'stop'});releaseCapture();say('You stopped sharing.');};
ui.quality.onchange=()=>{ui.qualityBadge.textContent=`${ui.quality.value}p / 30 FPS`;};
ui.enableSound.onclick=()=>{ui.screen.muted=false;ui.screen.play().then(()=>ui.enableSound.hidden=true).catch(err=>say(err.message));};
ui.invite.onclick=async()=>{try{await navigator.clipboard.writeText(location.href);say(location.hostname==='localhost'||location.hostname==='127.0.0.1'?'Invite copied. For another PC, use the server’s trusted HTTPS address instead of localhost (see README).':'Invite copied. Send it to your people.');}catch{say(`Copy this invite: ${location.href}`);}};
window.addEventListener('beforeunload',()=>{releaseCapture();ws?.close();});
