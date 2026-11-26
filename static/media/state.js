// State shared by the media modules. Plain objects are mutated, never reassigned,
// so every module sees the same data through its import.
export const media = {
  inVoice: false,
  muted: false,             // microphone cut by us (the track stays open but sends silence)
  localStream: null,        // microphone
  screenStream: null,       // our screen capture
  screenVideoTrack: null,
  screenStarting: false,
  users: [],                // latest user list from the server
  usersById: {},
  expandedScreenId: null,
  diagnosticsRunning: false
};

export const peerConnections = {};     // client id -> RTCPeerConnection
export const peerState = {};           // client id -> negotiation flags (perfect negotiation)
export const remoteScreenStreams = {}; // client id -> MediaStream
export const previousStats = new Map(); // client id -> last getStats() sample, for bitrates
