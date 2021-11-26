import express from 'express';
const app = express();
import http from 'http';
import mediasoup from 'mediasoup';

import https from 'httpolyglot';
import fs from 'fs';
import path from 'path';
const __dirname = path.resolve();

import { Server } from 'socket.io';

app.get('/', (req, res) => {
  res.send('Hello from mediasoup app!');
});

app.use('/sfu', express.static(path.join(__dirname, 'public')))


// SSL - Later
// const options = {
//   key: fs.readFileSync('./server/ssl/key.pem', 'utf-8'),
//   cert: fs.readFileSync('./server/ssl/cert.pem', 'utf-8')
// };

const httpServer = http.createServer(app);
httpServer.listen(3000, () => {
  console.log('LISTENING ON PORT 3000');
});

const io = new Server(httpServer);
const peers = io.of('/mediasoup');

let worker;
let router;

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 10000,
    rtcMaxPort: 10100
  });
  console.log('worker pid', worker.pid);

  worker.on('died', error => {
    console.error('mediasoup worker has died');
    setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
  });
  return worker;
}

worker = createWorker();

const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000
    }
  }
];

peers.on('connection', async socket => {
  console.log(socket.id);
  socket.emit('connection-success', {
    socketId: socket.id
  });

  socket.on('getRtpCapabilities', (callback) => {
    const rtpCapabilities = router.rtpCapabilities;
    console.log('rtp capabilities', rtpCapabilities);
    callback({ rtpCapabilities });
  })

  socket.on('disconnect', () => {
    // do some cleanup
    console.log('peer disconnected');
  })

  router = await worker.createRouter({ mediaCodecs });
})

