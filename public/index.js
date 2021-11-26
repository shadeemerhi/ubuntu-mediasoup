const io = require('socket.io-client');
const mediasoupClient = require('mediasoup-client');

const socket = io('/mediasoup');

socket.on('connection-success', ({ socketId }) => {
  console.log(socketId);
});

let device;
let rtpCapabilities;

let params = {
  // mediasoup params
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
}

btnLocalVideo.addEventListener('click', getLocalStream)
btnRtpCapabilities.addEventListener('click', getRtpCapabilities)
btnDevice.addEventListener('click', createDevice)
// btnCreateSendTransport.addEventListener('click', createSendTransport)
// btnConnectSendTransport.addEventListener('click', connectSendTransport)
// btnRecvSendTransport.addEventListener('click', createRecvTransport)
// btnConnectRecvTransport.addEventListener('click', connectRecvTransport)