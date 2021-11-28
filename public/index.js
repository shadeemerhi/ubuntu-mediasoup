const io = require("socket.io-client");
const mediasoupClient = require("mediasoup-client");

const roomName = window.location.pathname.split("/")[2];

const socket = io("/mediasoup");

socket.on("connection-success", ({ socketId, existsProducer }) => {
    console.log(socketId, existsProducer);
    getLocalStream();
});

let device;
let rtpCapabilities;
let sendTransport;
let recvTransport;
let recvTransports = [];
let videoProducer;
let videoConsumer;
let isProducer = false;

let params = {
    // mediasoup params
    encoding: [
        {
            rid: "r0",
            maxBitrate: 100000,
            scalabilityMode: "S1T3",
        },
        {
            rid: "r1",
            maxBitrate: 300000,
            scalabilityMode: "S1T3",
        },
        {
            rid: "r2",
            maxBitrate: 900000,
            scalabilityMode: "S1T3",
        },
    ],
    codecOptions: {
        videoGoogleStartBitrate: 1000,
    },
};
const streamSuccess = (stream) => {
    localVideo.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    params = {
        track,
        ...params,
    };

    joinRoom();
};

const joinRoom = () => {
    socket.emit("joinRoom", { roomName }, (data) => {
        console.log("ROUTER RTP CAPABILITIES", data.rtpCapabilities);
        rtpCapabilities = data.rtpCapabilities;

        // NOTE - Could create device directly in here, then add condition to check if producer or consumer

        createDevice();
    });
};

const getLocalStream = () => {
    navigator.mediaDevices
        .getUserMedia({
            // audio: true,
            video: {
                width: {
                    min: 640,
                    max: 1920,
                },
                height: {
                    min: 400,
                    max: 1080,
                },
            },
        })
        .then(streamSuccess)
        .catch((error) => console.log(error));
};

const goConsume = () => {
    goConnect(false);
};

const goConnect = (producerOrConsumer) => {
    isProducer = producerOrConsumer;
    device === undefined ? getRtpCapabilities() : goCreateTransport();
};

const goCreateTransport = () => {
    isProducer ? createSendTransport() : createRecvTransport();
};

const createDevice = async () => {
    try {
        console.log("createDevice()");
        device = new mediasoupClient.Device();

        await device.load({
            routerRtpCapabilities: rtpCapabilities,
        });

        console.log("DEVICE LOADED", device.rtpCapabilities);

        // Once the device loads, create transport
        // goCreateTransport(); // creates transport based on if consumer or producer (will use!!)

        // Video tutorial assumes everyone joining is a producer
        createSendTransport();
        /**
         * Could add a condition inside of joinRoom to check if producer or consumer and create
         * corresponding transports (like in mediasoup-demo source code)
         */
    } catch (error) {
        console.log(error);
        if (error.name === "UnsupportedError") {
            console.warn("Browser not supported");
        }
    }
};

const getRtpCapabilities = () => {
    console.log("getRtpCapabilities()");
    socket.emit("createRoom", async (data) => {
        rtpCapabilities = data.rtpCapabilities;
        console.log("RTP CAPABILITIES SUCCESS", rtpCapabilities);

        // Could do this?
        // device = new mediasoupClient.Device();
        // await device.load({ rtpCapabilities });

        createDevice();
    });
};

socket.on('new-producer', ({ producerId }) => signalNewConsumerTransport(producerId));

const getProducers = () => {
    socket.emit("getProducers", (producerIds) => {
        // For each producer in the room, create a new consumer
        producerIds.forEach(id => signalNewConsumerTransport(id));
    });
};

const createSendTransport = async () => {
    console.log("createWebRtcTransport()");
    socket.emit("createWebRtcTransport", { consumer: false }, ({ params }) => {
        if (params.error) {
            console.log(params.error);
            return;
        }
        console.log("SEND TRANSPORT PARAMS", params);
        sendTransport = device.createSendTransport(params);

        sendTransport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
                console.log("CONNECTING SEND TRANSPORT");
                try {
                    await socket.emit("transport-connect", {
                        transportId: sendTransport.id, // Used to find transport on server inside of array/Map (not doing that in this example, but that's how it would be done)
                        dtlsParameters: dtlsParameters,
                    });

                    // Tell the transport that parameters were transmitted
                    callback();
                } catch (error) {
                    errback(error);
                }
            }
        );

        sendTransport.on("produce", async (parameters, callback, errback) => {
            console.log("SEND TRANSPORT PRODUCING", parameters);
            try {
                await socket.emit(
                    "transport-produce",
                    {
                        kind: parameters.kind,
                        rtpParameters: parameters.rtpParameters,
                        appData: parameters.appData,
                    },
                    ({ id, producersExist }) => {
                        /**
                         * Tell the transport that parameters were transmitted and provide it
                         * with the server side producer's id
                         */
                        console.log("CALLBACK PRODUCER ID", id);
                        callback({ id });

                        // Existing producers on the server
                        if (producersExist) getProducers();
                    }
                );
            } catch (error) {
                errback(error);
            }
        });

        connectSendTransport();

        console.log("SEND TRANSPORT CREATED", sendTransport);
    });
};

const connectSendTransport = async () => {
    videoProducer = await sendTransport.produce(params);

    videoProducer.on("trackended", () => {
        console.log("track ended");

        // close video track
    });

    // If the user disables their webcam, a function should be called that calls videoProducer.close()
    videoProducer.on("transportclose", () => {
        console.log("transport ended");
        videoProducer = null;
    });

    console.log("VIDEO PRODUCER ID", videoProducer.id);
};

const signalNewConsumerTransport = async (remoteProducerId) => {
    await socket.emit(
        "createWebRtcTransport",
        { consumer: true },
        ({ params }) => {
            if (params.error) {
                console.log(error);
                return;
            }
            console.log("RECEIVE TRANSPORT PARAMS", params);
            recvTransport = device.createRecvTransport(params);

            recvTransport.on(
                "connect",
                async ({ dtlsParameters }, callback, errback) => {
                    try {
                        console.log("CONNECTING RECEIVE TRANSPORT");
                        // Signal the DTLS parameters to the server side transport
                        // Could have a single transport-connect event if server stored transports in an array by ID
                        // In this case we don't store them that way on the server so we use two separate events
                        await socket.emit("transport-connect-recv", {
                            transportId: recvTransport.id, // Used to find transport on server inside of array/Map (not doing that in this example, but that's how it would be done)
                            dtlsParameters,
                        });

                        // Tell the transport that parameters were transmitted
                        callback();
                    } catch (error) {
                        errback(error);
                    }
                }
            );
            // params.id is the server-side consumer transport's id
            connectRecvTransport(recvTransport, remoteProducerId, params.id);
        }
    );
};

const connectRecvTransport = async (recvTransport, remoteProducerId, serverConsumerTransportId) => {
    await socket.emit(
        "consume",
        {
            rtpCapabilities: device.rtpCapabilities,
            remoteProducerId,
            serverConsumerTransportId
        },
        async ({ params }) => {
            if (params.error) {
                console.log("cannot consume");
                return;
            }
            console.log("CONSUMER PARAMS");
            // Will store these consumers in state
            const consumer = await recvTransport.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters,
            });

            recvTransports = [
              ...recvTransports,
              {
                recvTransport,
                serverConsumerTransportId: params.id,
                producerId: remoteProducerId,
                consumer
              }
            ];

            const newElem = document.createElement('div');
            newElem.setAttribute('id', `td-${remoteProducerId}`);
            newElem.setAttribute('class', 'remoteVideo');
            newElem.innerHTML = '<video id="' + remoteProducerId + '"autoplay class="video" ></video';
            videoContainer.appendChild(newElem);

            const { track } = videoConsumer;
            // remoteVideo.srcObject = new MediaStream([track]);
            document.getElementById(remoteProducerId).srcObject = new MediaStream([track]);

            // socket.emit("consumer-resume");
            socket.emit('consumer-resume', { serverConsumerId: params.serverConsumerId });
        }
    );
};

socket.on('producer-closed', ({ remoteProducerId }) => {
  // server notification is received when a producer is closed
  // we need to close the client-side consumer and associated transport
  const producerToClose = consumerTransports.find(transportData => transportData.producerId === remoteProducerId);
  producerToClose.consumerTransport.close();
  producerToClose.consumer.close();

  // Remove the consumer transport from the list
  consumerTransports = consumerTransports.filter(transportData => transportData.producerId !== remoteProducerId);

  // Remove the video div element
  videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`));

})