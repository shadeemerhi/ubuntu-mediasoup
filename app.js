import express from 'express';
const app = express();
import http from 'http';

import https from 'httpolyglot';
import fs from 'fs';
import path from 'path';
const __dirname = path.resolve();

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
})

