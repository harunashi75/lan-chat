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
  await settings(alice,'media',() => alice.selectOption('#videoProfile','motion'));
  assert.equal(await alice.evaluate(() => __lanChat.media.screenVideoTrack.contentHint),'motion');
  await settings(bob,'media',() => bob.check('#shareAudio'));await bob.click('#screenShareBtn');await remoteVideo(alice);
  await Promise.all([alice.click('#voiceToggleBtn'),bob.click('#voiceToggleBtn')]);
  await alice.waitForFunction(() => [...document.querySelectorAll('#audioContainer audio')].filter(a => !a.muted).length===2);
  await bob.waitForFunction(() => [...document.querySelectorAll('#audioContainer audio')].filter(a => !a.muted).length===2);
  await alice.click('#voiceToggleBtn');
  await alice.waitForFunction(() => [...document.querySelectorAll('#audioContainer audio')].filter(a => !a.muted).length===1);
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
