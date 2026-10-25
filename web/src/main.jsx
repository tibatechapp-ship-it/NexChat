import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';

const SERVER = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SERVER) || 'http://localhost:3000';

function App() {
  const [name, setName] = useState('');
  const [room, setRoom] = useState('general');
  const [joined, setJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState('');
  const socketRef = useRef(null);

  useEffect(() => {
    const s = io(SERVER);
    socketRef.current = s;
    s.on('message', (m) => setMessages((prev) => [...prev, m]));
    s.on('system', (t) => setMessages((prev) => [...prev, { id: crypto.randomUUID(), from: 'system', text: t, ts: Date.now() }]));
    s.on('typing', ({ from, isTyping }) => setTyping(isTyping ? `${from} is typing...` : ''));
    return () => s.disconnect();
  }, []);

  const join = () => {
    if (!name.trim()) return;
    socketRef.current.emit('join', { name, room });
    setJoined(true);
  };

  const send = () => {
    if (!input.trim()) return;
    socketRef.current.emit('message', { room, text: input });
    setInput('');
  };

  if (!joined) {
    return (
      <div style={{ maxWidth: 400, margin: '80px auto', fontFamily: 'sans-serif' }}>
        <h2>NexChat</h2>
        <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', padding: 8, marginBottom: 8 }} />
        <input placeholder="Room" value={room} onChange={(e) => setRoom(e.target.value)} style={{ width: '100%', padding: 8, marginBottom: 8 }} />
        <button onClick={join} style={{ width: '100%', padding: 10 }}>Join</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: '20px auto', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', height: '90vh' }}>
      <h3>NexChat — {room}</h3>
      <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 8 }}>
            <b>{m.from}:</b> {m.text}
          </div>
        ))}
        {typing && <div style={{ fontStyle: 'italic', color: '#888' }}>{typing}</div>}
      </div>
      <div style={{ display: 'flex', marginTop: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          onInput={() => socketRef.current.emit('typing', { room, isTyping: true })}
          style={{ flex: 1, padding: 8 }} placeholder="Type a message..." />
        <button onClick={send} style={{ padding: '8px 16px' }}>Send</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
