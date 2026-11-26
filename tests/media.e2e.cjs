const {chromium} = require('playwright');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');

const base = 'http://127.0.0.1:18765';
const python = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
const server = spawn(path.resolve(python),['server.py'],{
  env:{...process.env,LAN_CHAT_HOST:'127.0.0.1',LAN_CHAT_PORT:'18765',LAN_CHAT_TUNNEL:'0',LAN_CHAT_ICE_SERVERS:'[]'},stdio:['ignore','pipe','pipe']
});
let output=''; server.stdout.on('data',d => output+=d); server.stderr.on('data',d => output+=d);
let browser;
const errors=[];
const externalRequests=[];
const pages=[];
async function waitServer() {
  for (let i=0;i<50;i++) {
    try { if ((await fetch(base+'/config')).ok) return; } catch { /* server not ready yet */ }
    await new Promise(r => setTimeout(r,100));
  }
  throw new Error(output);
}
async function participant(name, url=base) {
  const context=await browser.newContext();
  await context.addInitScript(() => {
    // navigator.mediaDevices does not exist on insecure (plain http, non-localhost) pages.
    if (navigator.mediaDevices) navigator.mediaDevices.getDisplayMedia = async options => {
      const canvas=document.createElement('canvas');
      canvas.width=1280; canvas.height=720;
      const ctx=canvas.getContext('2d'); let n=0;
      function draw() {
        ctx.fillStyle=n++%2 ? '#2460ab' : '#457530'; ctx.fillRect(0,0,1280,720);
        ctx.fillStyle='white';ctx.font='45px sans-serif';ctx.fillText('LAN Chat '+n,100,100);
      }
      draw(); const timer=setInterval(draw,33);
      const stream=canvas.captureStream(30);
      const video=stream.getVideoTracks()[0]; const stop=video.stop.bind(video);
      video.stop=() => { clearInterval(timer); stop(); };
      if (options.audio) {
        const audio=new AudioContext(); await audio.resume();
        const oscillator=audio.createOscillator(); const destination=audio.createMediaStreamDestination();
        oscillator.connect(destination);oscillator.start();
        const track=destination.stream.getAudioTracks()[0];
        const audioStop=track.stop.bind(track);
        track.stop=() => {oscillator.stop();audio.close();audioStop();};
        stream.addTrack(track);
      }
      return stream;
    };
  });
  const page=await context.newPage(); pages.push(page);
  page.on('pageerror',error => errors.push(error.message));
  page.on('console',msg => {if(msg.type()==='error') errors.push(msg.text());});
  page.on('request',request => {if(request.url().includes('gstatic.com')) externalRequests.push(request.url());});
  await page.goto(url);
  await page.fill('#nameInput',name);await page.click('#joinButton');
  await page.waitForFunction(() => __lanChat.ready && __lanChat.users.length>0);
  return page;
}
// Settings live in a dialog: open a tab, run the action, close it.
async function settings(page, tab, action) {
  await page.click('#settingsOpen');
  await page.click(`.settings-tab[data-tab="${tab}"]`);
  await action();
  await page.click('#settingsClose');
}
async function remoteVideo(page, expected=1) {
  await page.waitForFunction(count => [...document.querySelectorAll('.screen-tile video')].filter(v =>
    !v.id.endsWith(__lanChat.clientId) && v.readyState>=2 && v.videoWidth>0).length === count, expected,{timeout:15000});
}
(async () => {
try {
  await waitServer();
  browser=await chromium.launch({headless:true,args:['--disable-features=WebRtcHideLocalIpsWithMdns','--host-resolver-rules=MAP lan.test 127.0.0.1','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const alice=await participant('Alice');const bob=await participant('Bob');
  await alice.waitForFunction(() => __lanChat.users.length===2);
  await alice.fill('#messageInput','Bonjour WebSocket');await alice.click('#sendButton');
  await bob.waitForFunction(() => document.getElementById('messages').textContent.includes('Bonjour WebSocket'));
  // Typing hint reaches the other participant and disappears once the message is sent.
  await alice.fill('#messageInput','je tape un message');
  await bob.waitForFunction(() => document.getElementById('typing').textContent.includes('Alice écrit'),null,{timeout:5000});
  await alice.click('#sendButton');
  await bob.waitForFunction(() => document.getElementById('typing').textContent === '');
  // Images: attach with the file picker, send with a caption, view full size; paste and drop also attach.
  const drawPng = () => alice.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e04a7a'; ctx.fillRect(0,0,640,360);
    ctx.fillStyle = '#fff'; ctx.font = '60px sans-serif'; ctx.fillText('LAN Chat', 180, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await alice.setInputFiles('#fileInput',{name:'photo.png',mimeType:'image/png',buffer:Buffer.from(await drawPng(),'base64')});
  await alice.waitForSelector('#attachment:not([hidden])');
  await alice.fill('#messageInput','regardez ça');await alice.click('#sendButton');
  await bob.waitForFunction(() => { const img = document.querySelector('.chat-image'); return img && img.complete && img.naturalWidth > 0; },null,{timeout:10000});
  assert.equal(await bob.evaluate(() => document.querySelector('.bubble.has-image .bubble-text').textContent),'regardez ça');
  await bob.click('.chat-image');await bob.waitForSelector('#lightbox:not([hidden])');
  await bob.keyboard.press('Escape');await bob.waitForSelector('#lightbox',{state:'hidden'});
  await alice.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 50; canvas.height = 50;
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob],'coller.png',{type:'image/png'}));
    document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
  });
  await alice.waitForSelector('#attachment:not([hidden])');
  await alice.click('#attachmentRemove');await alice.waitForSelector('#attachment',{state:'hidden'});
  await alice.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 50; canvas.height = 50;
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob],'depose.png',{type:'image/png'}));
    document.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
  });
  await alice.waitForSelector('#attachment:not([hidden])');
  await alice.click('#attachmentRemove');
  // A message that arrives while the window is in the background raises the unread counter.
  await bob.evaluate(() => { document.hasFocus = () => false; });
  await alice.fill('#messageInput','compteur');await alice.click('#sendButton');
  await bob.waitForFunction(() => document.title.startsWith('(1)'));
  await bob.waitForFunction(() => document.querySelector('link[rel=icon]').href.startsWith('data:image/png'),null,{timeout:5000});
  await bob.evaluate(() => { delete document.hasFocus; window.dispatchEvent(new Event('focus')); });
  await bob.waitForFunction(() => document.title === 'LAN Chat');
  // Sound preferences persist.
  await settings(bob,'notifications',async () => {
    await bob.uncheck('#soundVoice');
    assert.equal(await bob.evaluate(() => localStorage.getItem('lan_chat_sound_voice')),'0');
    await bob.check('#soundVoice');
    await bob.click('#soundTest');
  });
  // The accent colour re-themes the whole UI.
  await settings(bob,'appearance',async () => {
    await bob.click('.swatch[data-accent="pink"]');
    assert.equal(await bob.evaluate(() => document.documentElement.dataset.accent),'pink');
    assert.match(await bob.evaluate(() => getComputedStyle(document.body).getPropertyValue('--blue')),/236/);
    await bob.click('.swatch[data-accent="blue"]');
    assert.equal(await bob.evaluate(() => document.documentElement.dataset.accent),undefined);
  });
  // A lone emoji makes no external request by default; the opt-in switch loads the animated image.
  await alice.fill('#messageInput','😀');await alice.click('#sendButton');
  await bob.waitForFunction(() => document.querySelector('.noto-emoji-fallback'));
  assert.deepEqual(externalRequests,[],'No request to Google by default');
  await settings(bob,'appearance',() => bob.check('#animatedEmoji'));
  await bob.waitForFunction(() => document.querySelector('img.noto-animated-emoji'));
  await settings(bob,'appearance',() => bob.uncheck('#animatedEmoji'));
  await bob.waitForFunction(() => !document.querySelector('img.noto-animated-emoji'));
  // Reaction by id, visible for the other participant.
  await bob.locator('.message-row').first().locator('.react-btn-trigger').click();
  await bob.locator('.quick-react-btn').first().click();
  await alice.waitForSelector('.reaction-badge.active', {state:'attached', timeout:3000}).then(() => {throw new Error('Alice must not see her own active badge');}, () => {});
  await alice.waitForFunction(() => document.querySelector('.reaction-badge')?.textContent.includes('1'));
  // Renaming propagates to everyone.
  await settings(bob,'profile',async () => {await bob.fill('#renameInput','Robert');await bob.click('#renameButton');});
  await alice.waitForFunction(() => document.getElementById('users').textContent.includes('Robert'));
  await settings(alice,'media',() => alice.check('#shareAudio'));await alice.click('#screenShareBtn');await remoteVideo(bob);
  await bob.waitForFunction(() => [...document.querySelectorAll('#audioContainer audio')].some(a => a.dataset.kind==='screen' && !a.muted));
  await settings(alice,'media',() => alice.click('.profile-card[data-profile="motion"]'));
  assert.equal(await alice.evaluate(() => __lanChat.media.screenVideoTrack.contentHint),'motion');
  await settings(bob,'media',() => bob.check('#shareAudio'));await bob.click('#screenShareBtn');await remoteVideo(alice);
  await Promise.all([alice.click('#voiceToggleBtn'),bob.click('#voiceToggleBtn')]);
  await alice.waitForFunction(() => [...document.querySelectorAll('#audioContainer audio')].filter(a => !a.muted).length===2);
  await bob.waitForFunction(() => [...document.querySelectorAll('#audioContainer audio')].filter(a => !a.muted).length===2);
  // Fake microphones emit beeps: both our own and the remote ring must light up, in the accent colour.
  const aliceId=await alice.evaluate(() => __lanChat.clientId), bobId=await bob.evaluate(() => __lanChat.clientId);
  await alice.waitForSelector(`#users .avatar.speaking[data-user-id="${aliceId}"]`,{timeout:15000});
  await alice.waitForSelector(`#users .avatar.speaking[data-user-id="${bobId}"]`,{timeout:15000});
  assert.match(await alice.evaluate(() => getComputedStyle(document.querySelector('#users .avatar.speaking')).boxShadow),/22, 131, 255/);
  await alice.click('#voiceToggleBtn');
  await alice.waitForFunction(() => [...document.querySelectorAll('#audioContainer audio')].filter(a => !a.muted).length===1);
  await alice.waitForFunction(id => !document.querySelector(`#users .avatar.speaking[data-user-id="${id}"]`),aliceId,{timeout:5000});
  await bob.uncheck('#receiveScreens');
  await bob.waitForFunction(() => Object.keys(__lanChat.media.remoteScreenStreams).length===0);
  await alice.waitForFunction(() => Object.values(__lanChat.media.peerConnections).every(pc => !pc.getSenders().some(s => s.track?.kind==='video')));
  await bob.check('#receiveScreens');await remoteVideo(bob);
  await alice.click('#screenShareBtn');
  await bob.waitForFunction(() => Object.keys(__lanChat.media.remoteScreenStreams).length===0);
  await alice.click('#screenShareBtn');await remoteVideo(bob);
  await bob.waitForFunction(() => document.getElementById('mediaStats').textContent.includes('Réception'));
  // Capture the updated interface for visual inspection, with diagnostics expanded.
  await bob.click('#settingsOpen');await bob.click('.settings-tab[data-tab="diagnostics"]');
  await bob.screenshot({path:process.env.LAN_CHAT_SCREENSHOT || '/tmp/lan-chat-preview.png'});
  await bob.click('#settingsClose');
  // Simulate a transient signaling drop; active capture must reconnect automatically.
  await bob.evaluate(() => __lanChat.socket.close());
  await bob.waitForFunction(() => __lanChat.ready && __lanChat.users.length===2);
  await remoteVideo(bob);await remoteVideo(alice);
  await bob.close();
  await alice.waitForFunction(() => __lanChat.users.length===1 && Object.keys(__lanChat.media.peerConnections).length===0);
  // Late joiner receives an already active screen without joining voice.
  const charlie=await participant('Charlie');await remoteVideo(charlie);
  await charlie.close();
  // A guest on plain http://<lan host> has no secure context: crypto.randomUUID is missing there.
  const dave=await participant('Dave','http://lan.test:18765');
  assert.equal(await dave.evaluate(() => window.isSecureContext),false);
  await dave.waitForFunction(() => document.getElementById('messages').textContent.includes('Bonjour WebSocket'));
  await dave.close();
  await alice.click('#screenShareBtn');
  assert.deepEqual(errors,[],'Browser errors');
  console.log('PASS: chat, real WebRTC video/audio, simultaneous sharing, profiles, voice isolation, receive toggle, stop/restart, reconnect, departure and late join');
} catch(error) {
  for (const page of pages.filter(p => !p.isClosed())) {
    console.error(JSON.stringify(await page.evaluate(() => ({
      users:__lanChat.users,
      peers:Object.fromEntries(Object.entries(__lanChat.media.peerConnections).map(([id,p]) => [id,{connection:p.connectionState,signaling:p.signalingState,ice:p.iceConnectionState,gathering:p.iceGatheringState,senders:p.getSenders().map(s=>s.track?.kind)}])),
      audio:[...document.querySelectorAll('audio')].map(a=>({id:a.id,kind:a.dataset.kind,muted:a.muted})),
      stats:document.getElementById('mediaStats').textContent
    })).catch(()=>({})),null,2));
  }
  console.error(errors,output); throw error;
} finally {
  if(browser) await browser.close();
  server.kill();
}

})().catch(error => { console.error(error);process.exitCode=1; });
