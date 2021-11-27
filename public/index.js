const io = require('socket.io-client');
const mediasoupClient = require('mediasoup-client');

const socket = io('/mediasoup');

socket.on('connection-success', ({ socketId }) => {
  console.log(socketId);
});

let device;
let rtpCapabilities;
let sendTransport;
let videoProducer;

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
    console.log('TRANSPORT PARAMS', params);
    sendTransport = device.createSendTransport(params);

    sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      console.log('CONNECTING SEND TRANSPORT');
      try {
        await socket.emit('transport-connect', {
          dtlsParameters: dtlsParameters
        });
        
        // Tell the transport that parameters were transmitted
        callback();
      } catch (error) {
        errback(error);
      }
    });
    
    sendTransport.on('produce', async (parameters, callback, errback) => {
      console.log('SEND TRANSPORT PRODUCING');
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
  
  console.log('INSIDE CONNECT SEND TRANSPORT', videoProducer.id);
}

btnLocalVideo.addEventListener('click', getLocalStream)
btnRtpCapabilities.addEventListener('click', getRtpCapabilities)
btnDevice.addEventListener('click', createDevice)
btnCreateSendTransport.addEventListener('click', createSendTransport)
btnConnectSendTransport.addEventListener('click', connectSendTransport)
// btnRecvSendTransport.addEventListener('click', createRecvTransport)
// btnConnectRecvTransport.addEventListener('click', connectRecvTransport)