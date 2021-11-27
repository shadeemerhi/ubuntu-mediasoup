const io = require('socket.io-client');
const mediasoupClient = require('mediasoup-client');

const socket = io('/mediasoup');

socket.on('connection-success', ({ socketId }) => {
  console.log(socketId);
});

let device;
let rtpCapabilities;
let sendTransport;
let recvTransport;

/**
 * Typically producers and consumers are stored in state on the client
 * As producers and consumers are created, they are added to state
 * These producers and consumers can then be found by id
 * In this case, since we have one producer and one consumer, we declare them globally as single vars
 */
let videoProducer;
let videoConsumer;

let params = {
  // mediasoup params
  encoding: [
    {
      rid: 'r0',
      maxBitrate: 100000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r1',
      maxBitrate: 300000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r2',
      maxBitrate: 900000,
      scalabilityMode: 'S1T3',
    },
  ],
  codecOptions: {
    videoGoogleStartBitrate: 1000
  }
}
const streamSuccess = async (stream) => {
  localVideo.srcObject = stream;
  const track = stream.getVideoTracks()[0];
  params = {
    track,
    ...params
  }
}

const getLocalStream = () => {
  navigator.getUserMedia({
    // audio: true,
    video: {
      width: {
        min: 640, 
        max: 1920
      },
      height: {
        min: 400,
        max: 1080
      }
    }
  }, streamSuccess, error => {
    console.log(error.message);
  })
}

const createDevice = async () => {
  try {
    console.log('createDevice()');
    device = new mediasoupClient.Device();
    
    await device.load({
      routerRtpCapabilities: rtpCapabilities
    })
    
    console.log('DEVICE LOADED', device.rtpCapabilities);
  } catch (error) {
    console.log(error);
    if (error.name === 'UnsupportedError') {
      console.warn('Browser not supported');
    }
  }
}

const getRtpCapabilities = () => {
  console.log('getRtpCapabilities()');
  socket.emit('getRtpCapabilities', async (data) => {
    rtpCapabilities = data.rtpCapabilities;
    console.log("RTP CAPABILITIES SUCCESS", rtpCapabilities);
    await createDevice();
  })
};

const createSendTransport = async () => {
  console.log('createWebRtcTransport()');
  socket.emit('createWebRtcTransport', { sender: true },  ({ params }) => {
    if (params.error) {
      console.log(params.error);
      return;
    }
    console.log('SEND TRANSPORT PARAMS', params);
    sendTransport = device.createSendTransport(params);

    sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      console.log('CONNECTING SEND TRANSPORT');
      try {
        await socket.emit('transport-connect', {
          transportId: sendTransport.id, // Used to find transport on server inside of array/Map (not doing that in this example, but that's how it would be done)
          dtlsParameters: dtlsParameters
        });
        
        // Tell the transport that parameters were transmitted
        callback();
      } catch (error) {
        errback(error);
      }
    });
    
    sendTransport.on('produce', async (parameters, callback, errback) => {
      console.log('SEND TRANSPORT PRODUCING', parameters);
      try {
        await socket.emit('transport-produce', {
          kind: parameters.kind,
          rtpParameters: parameters.rtpParameters,
          appData: parameters.appData
        }, ({ id })=> {
          /**
           * Tell the transport that parameters were transmitted and provide it
           * with the server side producer's id
           */
          console.log('CALLBACK PRODUCER ID', id);
          callback({ id });
        })
      } catch (error) {
        errback(error);
      }
    })

    console.log('SEND TRANSPORT CREATED', sendTransport);
  })

};

const connectSendTransport = async () => {
  videoProducer = await sendTransport.produce(params);

  videoProducer.on('trackended', () => {
    console.log('track ended');

    // close video track
  });

  // If the user disables their webcam, a function should be called that calls videoProducer.close()
  videoProducer.on('transportclose', () => {
    console.log('transport ended');
    videoProducer = null;
  });
  
  console.log('VIDEO PRODUCER ID', videoProducer.id);
};

const createRecvTransport = async () => {
  socket.emit('createWebRtcTransport', { sender: false }, ({ params}) => {
    if (params.error) {
      console.log(error);
      return;
    }
    console.log('RECEIVE TRANSPORT PARAMS', params);
    recvTransport = device.createRecvTransport(params);

    recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        console.log('CONNECTING RECEIVE TRANSPORT');
        // Signal the DTLS parameters to the server side transport
        // Could have a single transport-connect event if server stored transports in an array by ID
        // In this case we don't store them that way on the server so we use two separate events
        await socket.emit('transport-connect-recv', {
          transportId: recvTransport.id, // Used to find transport on server inside of array/Map (not doing that in this example, but that's how it would be done)
          dtlsParameters
        });

        // Tell the transport that parameters were transmitted
        callback();
      } catch (error) {
        errback(error);
      }
    })

  })
};

const connectRecvTransport = async () => {
  await socket.emit('consume', {
    rtpCapabilities: device.rtpCapabilities,
  }, async ({ params }) => {
    if (params.error) {
      console.log('cannot consume');
      return;
    }
    console.log('CONSUMER PARAMS');
    // Will store these consumers in state
    videoConsumer = await recvTransport.consume({
      id: params.id,
      producerId: params.producerId,
      kind: params.kind,
      rtpParameters: params.rtpParameters
    });

    const { track } = videoConsumer;
    remoteVideo.srcObject = new MediaStream([track]);

    socket.emit('consumer-resume');
  })
}

btnLocalVideo.addEventListener('click', getLocalStream)
btnRtpCapabilities.addEventListener('click', getRtpCapabilities)
btnDevice.addEventListener('click', createDevice)
btnCreateSendTransport.addEventListener('click', createSendTransport)
btnConnectSendTransport.addEventListener('click', connectSendTransport)
btnRecvSendTransport.addEventListener('click', createRecvTransport)
btnConnectRecvTransport.addEventListener('click', connectRecvTransport)