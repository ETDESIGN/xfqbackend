require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fetch = require('cross-fetch');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// CORS configuration to allow only the frontend domain
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));

app.use(express.json());

// Multer configuration for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Endpoint 1: Contact Form 7 Proxy
app.post('/api/submit-quote', upload.single('file-attachment'), async (req, res) => {
  try {
    // Create FormData to forward the request
    const formData = new FormData();

    // Add all text fields from req.body
    for (const key in req.body) {
      formData.append(key, req.body[key]);
    }

    // Add the file if present
    if (req.file) {
      formData.append('file-attachment', req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype
      });
    }

    // Forward the request to WordPress
    const response = await fetch(process.env.WORDPRESS_API_ENDPOINT, {
      method: 'POST',
      body: formData
    });

    // Relay the response back to the client
    const responseText = await response.text();
    res.status(response.status).send(responseText);
  } catch (error) {
    console.error('Error in /api/submit-quote:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Endpoint 2: Gemini Chat Proxy
app.post('/api/chat', async (req, res) => {
  try {
    const { contents, systemInstruction } = req.body;

    // Initialize Google Generative AI
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    // Prepare the request for streaming
    const request = {
      contents: contents
    };

    if (systemInstruction) {
      request.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    // Set headers for NDJSON streaming
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Generate streaming content
    const result = await model.generateContentStream(request);

    // Stream the response
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      res.write(JSON.stringify({ type: 'chunk', data: chunkText }) + '\n');
    }

    // End of stream
    res.write(JSON.stringify({ type: 'end', data: null }) + '\n');
    res.end();
  } catch (error) {
    console.error('Error in /api/chat:', error);

    if (!res.headersSent) {
      // If headers not sent, send standard JSON error
      res.status(500).json({ error: error.message });
    } else {
      // If streaming started, send error as NDJSON
      res.write(JSON.stringify({ type: 'error', data: error.message }) + '\n');
      res.end();
    }
  }
});

// Export for Vercel
module.exports = app;