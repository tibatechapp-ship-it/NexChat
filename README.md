# NexChat

Modern WhatsApp-style chat app — web + mobile + real-time server, works over internet AND local WiFi (no internet needed on the same LAN).

## Architecture

```
NexChat/
├── server/     Node.js + Socket.IO + Express (real-time gateway)
├── web/        Vite + React (browser client, PWA-ready)
├── mobile/     Flutter (Android/iOS native client)
└── shared/     Shared types & protocol
```

## Features (planned)

- 1:1 and group chats
- Works on local WiFi (LAN) without internet
- Works over internet (cloud relay)
- Media (images, voice notes, files)
- Read receipts, typing indicators, presence
- End-to-end encryption (planned)
- PWA + native mobile

## Quick start

### Server
cd server && npm install && npm run dev

### Web client
cd web && npm install && npm run dev

### Mobile
cd mobile && flutter pub get && flutter run

## License

MIT
