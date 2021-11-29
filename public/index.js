//index.js
const io = require("socket.io-client");
const mediasoupClient = require("mediasoup-client");

const roomName = window.location.pathname.split("/")[2];

const socket = io("/mediasoup");

const isProducing = window.location.search.includes("admin");
const isConsuming = !window.location.search.includes("admin");

socket.on("connection-success", ({ socketId }) => {
    console.log(socketId);
    if (isProducing) {
        console.log("PRODUCING");
        getLocalStream();
    }
    if (isConsuming) {
        console.log("CONSUMING");
        joinRoom();
    }
});

let device;
let rtpCapabilities;
let producerTransport;
let recvTransport;
let consumerTransports = [];
let producer;
let consumer;
let isProducer = false;

console.log("HERE IS PATH", window.location.search);

console.log("PRODUCING CONSUMING", isProducing, isConsuming);

// let isProducing = true;
// let isConsuming = true;

// https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerOptions
// https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
let params = {
    // mediasoup params
    encodings: [
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
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
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

    /**
     * Currently weird way of removing local video for consumers
     * Not sure why only calling getLocalStream for producers does not work
     */
    // if (isConsuming) localVideo.srcObject = null;
    
    joinRoom();
};

const joinRoom = () => {
    if (isConsuming) localVideo.remove();
    socket.emit("joinRoom", { roomName, isAdmin: isProducing }, (data) => {
        console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`);
        // we assign to local variable and will be used when
        // loading the client Device (see createDevice above)
        rtpCapabilities = data.rtpCapabilities;

        // once we have rtpCapabilities from the Router, create Device
        createDevice();
    });
};

const getLocalStream = () => {
    if (true) {
        navigator.mediaDevices
            .getUserMedia({
                audio: false,
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
            .catch((error) => {
                console.log(error.message);
            });
    }
};

// A device is an endpoint connecting to a Router on the
// server side to send/recive media
const createDevice = async () => {
    try {
        device = new mediasoupClient.Device();

        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
        // Loads the device with RTP capabilities of the Router (server side)
        await device.load({
            // see getRtpCapabilities() below
            routerRtpCapabilities: rtpCapabilities,
        });

        console.log("Device RTP Capabilities", device.rtpCapabilities);

        // once the device loads, create transport
        if (isProducing) {
            createSendTransport();
        }

        if (isConsuming) {
            createRecvTransport();
        }
    } catch (error) {
        console.log(error);
        if (error.name === "UnsupportedError")
            console.warn("browser not supported");
    }
};

const createSendTransport = () => {
    // see server's socket.on('createWebRtcTransport', sender?, ...)
    // this is a call from Producer, so sender = true
    socket.emit("createWebRtcTransport", { consumer: false }, ({ params }) => {
        // The server sends back params needed
        // to create Send Transport on the client side
        if (params.error) {
            console.log(params.error);
            return;
        }

        console.log(params);

        // creates a new WebRTC Transport to send media
        // based on the server's producer transport params
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
        producerTransport = device.createSendTransport(params);

        // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
        // this event is raised when a first call to transport.produce() is made
        // see connectSendTransport() below
        producerTransport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
                try {
                    // Signal local DTLS parameters to the server side transport
                    // see server's socket.on('transport-connect', ...)
                    await socket.emit("transport-connect", {
                        dtlsParameters,
                    });

                    // Tell the transport that parameters were transmitted.
                    callback();
                } catch (error) {
                    errback(error);
                }
            }
        );

        producerTransport.on(
            "produce",
            async (parameters, callback, errback) => {
                console.log(parameters);

                try {
                    // tell the server to create a Producer
                    // with the following parameters and produce
                    // and expect back a server side producer id
                    // see server's socket.on('transport-produce', ...)
                    await socket.emit(
                        "transport-produce",
                        {
                            kind: parameters.kind,
                            rtpParameters: parameters.rtpParameters,
                            appData: parameters.appData,
                        },
                        ({ id, producersExist }) => {
                            // Tell the transport that parameters were transmitted and provide it with the
                            // server side producer's id.
                            callback({ id });

                            // if producers exist, then join room
                            if (producersExist) getProducers();
                        }
                    );
                } catch (error) {
                    errback(error);
                }
            }
        );

        connectSendTransport();
    });
    console.log("SEND TRANSPORT CREATED");
};

const createRecvTransport = async () => {
    await socket.emit(
        "createWebRtcTransport",
        { consumer: true },
        ({ params }) => {
            // The server sends back params needed
            // to create Send Transport on the client side
            if (params.error) {
                console.log(params.error);
                return;
            }
            console.log(`PARAMS... ${params}`);

            // let consumerTransport;
            try {
                // consumerTransport = device.createRecvTransport(params);
                recvTransport = device.createRecvTransport(params);
            } catch (error) {
                // exceptions:
                // {InvalidStateError} if not loaded
                // {TypeError} if wrong arguments.
                console.log(error);
                return;
            }

            recvTransport.on(
                "connect",
                async ({ dtlsParameters }, callback, errback) => {
                    try {
                        // Signal local DTLS parameters to the server side transport
                        // see server's socket.on('transport-recv-connect', ...)
                        console.log("INSIDE CONNECT EVENT", dtlsParameters);
                        await socket.emit("transport-recv-connect", {
                            serverConsumerTransportId: recvTransport.id,
                            dtlsParameters,
                            // serverConsumerTransportId: params.id,
                        });

                        // Tell the transport that parameters were transmitted.
                        callback();
                    } catch (error) {
                        // Tell the transport that something was wrong
                        errback(error);
                    }
                }
            );

            // Get server-side producer(s)
            getProducers();

            // connectRecvTransport(
            //     recvTransport,
            //     // remoteProducerId,
            //     // params.id
            //     recvTransport.id
            // );
        }
    );
    console.log("RECV TRANSPORT CREATED");
};

const connectSendTransport = async () => {
    // we now call produce() to instruct the producer transport
    // to send media to the Router
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    // this action will trigger the 'connect' and 'produce' events above
    producer = await producerTransport.produce(params);

    producer.on("trackended", () => {
        console.log("track ended");

        // close video track
    });

    producer.on("transportclose", () => {
        console.log("transport ended");

        // close video track
    });
};

const signalNewConsumerTransport = async (remoteProducerId) => {
    console.log("INSIDE SIGNAL NEW CONSUMER TRANSPORT");
    await socket.emit(
        "createWebRtcTransport",
        { consumer: true },
        ({ params }) => {
            // The server sends back params needed
            // to create Send Transport on the client side
            if (params.error) {
                console.log(params.error);
                return;
            }
            console.log(`PARAMS... ${params}`);

            let consumerTransport;
            try {
                consumerTransport = device.createRecvTransport(params);
            } catch (error) {
                // exceptions:
                // {InvalidStateError} if not loaded
                // {TypeError} if wrong arguments.
                console.log(error);
                return;
            }

            consumerTransport.on(
                "connect",
                async ({ dtlsParameters }, callback, errback) => {
                    try {
                        // Signal local DTLS parameters to the server side transport
                        // see server's socket.on('transport-recv-connect', ...)
                        console.log(
                            "INSIDE CONNECT EVENT - SHOULD ONLY HAPPEN ONCE PER CLIENT"
                        );
                        await socket.emit("transport-recv-connect", {
                            dtlsParameters,
                            serverConsumerTransportId: params.id,
                        });

                        // Tell the transport that parameters were transmitted.
                        callback();
                    } catch (error) {
                        // Tell the transport that something was wrong
                        errback(error);
                    }
                }
            );

            connectRecvTransport(
                consumerTransport,
                remoteProducerId,
                params.id
            );
        }
    );
};

// server informs the client of a new producer just joined
socket.on("new-producer", ({ producerId }) => {
    console.log("NEW PRODUCER", producerId);
    connectRecvTransport(producerId);
});

socket.on("new-consumer", () => {
    console.log("NEW CONSUMER!!!");
});

const getProducers = () => {
    connectRecvTransport();
    socket.emit("getProducers", (producerIds) => {
        console.log("PRODUCER IDS", producerIds);
        // for each of the producer create a consumer
        // producerIds.forEach(id => signalNewConsumerTransport(id))
        // producerIds.forEach(signalNewConsumerTransport);
        producerIds.forEach(id => connectRecvTransport(id));
    });
};

const connectRecvTransport = async (
    // consumerTransport,
    remoteProducerId
    // serverConsumerTransportId
) => {
    console.log("INSIDE FUNCTION THING");
    // for consumer, we need to tell the server first
    // to create a consumer based on the rtpCapabilities and consume
    // if the router can consume, it will send back a set of params as below
    await socket.emit(
        "consume",
        {
            rtpCapabilities: device.rtpCapabilities,
            remoteProducerId,
            serverConsumerTransportId: recvTransport.id,
        },
        async ({ params }) => {
            if (params.error) {
                console.log("Cannot Consume");
                return;
            }

            console.log(`Consumer Params ${params}`);
            // then consume with the local consumer transport
            // which creates a consumer
            console.log(
                "ABOUT TO CALL CLIENT SIDE CONSUME",
                remoteProducerId,
                params.producerId
            );
            const consumer = await recvTransport.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters,
            });

            consumerTransports = [
                ...consumerTransports,
                {
                    // consumerTransport,
                    consumerTransport: recvTransport,
                    serverConsumerTransportId: params.id,
                    producerId: remoteProducerId,
                    consumer,
                },
            ];

            // create a new div element for the new consumer media
            // and append to the video container
            const newElem = document.createElement("div");
            newElem.setAttribute("id", `td-${remoteProducerId}`);
            newElem.setAttribute("class", "remoteVideo");
            newElem.innerHTML =
                '<video id="' +
                remoteProducerId +
                '" autoplay muted class="video" ></video>';
            videoContainer.appendChild(newElem);

            // destructure and retrieve the video track from the producer
            const { track } = consumer;
            console.log("HERE IS TRACK", track);

            document.getElementById(remoteProducerId).srcObject =
                new MediaStream([track]);

            console.log('THING AFTER', document.getElementById(remoteProducerId));

            // the server consumer started with media paused
            // so we need to inform the server to resume
            console.log("NEW CONSUMER ID", consumer.id);
            socket.emit("consumer-resume", {
                serverConsumerId: params.serverConsumerId,
            });
        }
    );
};

socket.on("producer-closed", ({ remoteProducerId }) => {
    console.log("PRODUCER CLOSED", remoteProducerId);
    // server notification is received when a producer is closed
    // we need to close the client-side consumer and associated transport
    const producerToClose = consumerTransports.find(
        (transportData) => transportData.producerId === remoteProducerId
    );
    producerToClose.consumerTransport.close();
    producerToClose.consumer.close();

    // remove the consumer transport from the list
    consumerTransports = consumerTransports.filter(
        (transportData) => transportData.producerId !== remoteProducerId
    );

    // remove the video div element
    videoContainer.removeChild(
        document.getElementById(`td-${remoteProducerId}`)
    );
});
