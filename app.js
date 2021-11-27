import express from "express";
const app = express();
import http from "http";
import mediasoup from "mediasoup";

import https from "httpolyglot";
import fs from "fs";
import path from "path";
const __dirname = path.resolve();

import { Server } from "socket.io";

app.get("/", (req, res) => {
    res.send("Hello from mediasoup app!");
});

app.use("/sfu", express.static(path.join(__dirname, "public")));

// SSL - Later
// const options = {
//   key: fs.readFileSync('./server/ssl/key.pem', 'utf-8'),
//   cert: fs.readFileSync('./server/ssl/cert.pem', 'utf-8')
// };

const httpServer = http.createServer(app);
httpServer.listen(3000, () => {
    console.log("LISTENING ON PORT 3000");
});

const io = new Server(httpServer);
const peers = io.of("/mediasoup");

let worker;
let router;
let producerTransport;
let consumerTransport;

const createWorker = async () => {
    worker = await mediasoup.createWorker({
        rtcMinPort: 10000,
        rtcMaxPort: 10100,
    });
    console.log("worker pid", worker.pid);

    worker.on("died", (error) => {
        console.error("mediasoup worker has died");
        setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
    });
    return worker;
};

worker = createWorker();

const mediaCodecs = [
    {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
    },
    {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: {
            "x-google-start-bitrate": 1000,
        },
    },
];

peers.on("connection", async (socket) => {
    console.log(socket.id);
    socket.emit("connection-success", {
        socketId: socket.id,
    });

    socket.on("getRtpCapabilities", (callback) => {
        const rtpCapabilities = router.rtpCapabilities;
        console.log("rtp capabilities", rtpCapabilities);
        callback({ rtpCapabilities });
    });

    socket.on("createWebRtcTransport", async ({ sender }, callback) => {
        if (sender) {
            producerTransport = await createWebRtcTransport(callback);
        } else {
            consumerTransport = await createWebRtcTransport(callback);
        }
    });

    socket.on('transport-connect', async ({ dtlsParameters }) => {
      await producerTransport.connect({ dtlsParameters });
    });

    socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
      const producer = await producerTransport.produce({
        kind,
        rtpParameters,
        // appData
      });

      producer.on('transportclose', () => {
        console.log('transport for this producer was closed');
        producer.close();
      })

      // Pass the producer id back to the client
      callback({ id: producer.id });

      // This is where the mediasoup-demo would store this producer in the peer of producers

    })

    socket.on("disconnect", () => {
        // do some cleanup
        console.log("peer disconnected");
    });

    router = await worker.createRouter({ mediaCodecs });
});

const createWebRtcTransport = async (callback) => {
    try {
      const webRtcTransportOptions = {
        listenIps: [
          {
            ip: '127.0.0.1',
          }
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true
      }
      let transport = await router.createWebRtcTransport(webRtcTransportOptions);
      console.log('transport id', transport.id);
      transport.on('dtlsstatechange', dtlsState => {
        if (dtlsState === 'closed') {
          transport.close();
        }
      })

      transport.on('close', () => {
        console.log('transport closed', transport.id);
      });

      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        }
      });
      return transport;
    } catch (error) {
        console.log(error);
        callback({
            params: {
                error,
            },
        });
    }
};
