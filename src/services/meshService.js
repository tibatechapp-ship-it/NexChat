/**
 * خدمة التواصل عبر BroadcastChannel (محاكاة Mesh محلية)
 */

export class MeshService {
  constructor(nodeId, channelName = "sila-mesh-room") {
    this.nodeId = nodeId;
    this.channel = new BroadcastChannel(channelName);
    this.onMessageCallback = null;
    this.onPresenceCallback = null;
    
    this.setupListeners();
  }

  setupListeners() {
    this.channel.onmessage = (event) => {
      if (event.data.from === this.nodeId) return;
      
      if (event.data.type === "presence" && this.onPresenceCallback) {
        this.onPresenceCallback(event.data);
      }
      
      if (event.data.type === "message" && this.onMessageCallback) {
        this.onMessageCallback(event.data);
      }
    };
  }

  sendMessage(message) {
    this.channel.postMessage({ 
      type: "message", 
      from: this.nodeId, 
      message 
    });
  }

  announcePresence() {
    this.channel.postMessage({ 
      type: "presence", 
      from: this.nodeId, 
      at: Date.now() 
    });
  }

  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  onPresence(callback) {
    this.onPresenceCallback = callback;
  }

  close() {
    this.channel.close();
  }
}
