const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const users = new Map();

io.on('connection', (socket) => {
  console.log('connect', socket.id);

  socket.on('join', ({ name, room }) => {
    socket.join(room);
    users.set(socket.id, { name, room });
    socket.to(room).emit('system', `${name} joined`);
    io.to(room).emit('presence', { room, count: io.sockets.adapter.rooms.get(room)?.size || 0 });
  });

  socket.on('message', ({ room, text }) => {
    const u = users.get(socket.id);
    if (!u) return;
    const msg = { id: uuidv4(), from: u.name, text, ts: Date.now() };
    io.to(room).emit('message', msg);
  });

  socket.on('typing', ({ room, isTyping }) => {
    const u = users.get(socket.id);
    if (!u) return;
    socket.to(room).emit('typing', { from: u.name, isTyping });
  });

  socket.on('disconnect', () => {
    const u = users.get(socket.id);
    if (u) {
      socket.to(u.room).emit('system', `${u.name} left`);
      users.delete(socket.id);
    }
    console.log('disconnect', socket.id);
  });
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'NexChat', version: '0.1.0' }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`NexChat server listening on :${PORT}`));
