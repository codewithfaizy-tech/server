// server.js
const WebSocket = require('ws');
const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON); // Your Firebase Admin SDK key file

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`WebSocket server running on port ${PORT}`);

// Map to track connected clients: userId => WebSocket
const clients = new Map();

wss.on('connection', (ws) => {
  console.log('New client connected, awaiting registration');

  // Flag to check if user is authenticated
  let authenticatedUserId = null;

  ws.on('message', async (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (err) {
      ws.send(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // First, user must register with their Firebase ID token
    if (data.type === 'register' && data.token) {
      try {
        const decodedToken = await admin.auth().verifyIdToken(data.token);
        authenticatedUserId = decodedToken.uid;
        clients.set(authenticatedUserId, ws);
        ws.send(JSON.stringify({ type: 'register', status: 'success' }));
        console.log(`User authenticated: ${authenticatedUserId}`);
      } catch (error) {
        ws.send(JSON.stringify({ type: 'register', status: 'fail', message: 'Invalid token' }));
        console.error('Failed to authenticate user:', error);
        ws.close();
      }
      return;
    }

    // Reject any message if user not authenticated
    if (!authenticatedUserId) {
      ws.send(JSON.stringify({ error: 'Not authenticated. Please register first.' }));
      ws.close();
      return;
    }

    // Handle sending message to specific user
    if (data.type === 'message') {
      const recipientId = data.to;
      const messageText = data.message;

      if (!recipientId || !messageText) {
        ws.send(JSON.stringify({ error: 'Missing "to" or "message" fields' }));
        return;
      }

      const recipientSocket = clients.get(recipientId);

      if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
        recipientSocket.send(JSON.stringify({
          from: authenticatedUserId,
          message: messageText,
          timestamp: Date.now()
        }));
        ws.send(JSON.stringify({ type: 'message', status: 'sent' }));
      } else {
        ws.send(JSON.stringify({ type: 'message', status: 'failed', message: 'Recipient not connected' }));
      }
    }
  });

  ws.on('close', () => {
    if (authenticatedUserId) {
      clients.delete(authenticatedUserId);
      console.log(`User disconnected: ${authenticatedUserId}`);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

function sendPushNotification(fcmToken, senderId, message) {
  const payload = {
      notification: {
          title: `New message from ${senderId}`,
          body: message
      },
      data: {
          senderId: senderId,
          message: message
      }
  };

  admin.messaging().sendToDevice(fcmToken, payload)
      .then(response => console.log('Notification sent:', response))
      .catch(err => console.log(err));
}

