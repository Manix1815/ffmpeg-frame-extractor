const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

app.post('/extract-frame', async (req, res) => {
  const { videoUrl } = req.body;
  
  if (!videoUrl) {
    return res.status(400).json({ error: 'videoUrl es obligatorio' });
  }

  const timestamp = Date.now();
  const inputPath = `/tmp/video_${timestamp}.mp4`;
  const outputPath = `/tmp/frame_${timestamp}.jpg`;

  try {
    // Descarga el video
    const response = await axios({ 
      url: videoUrl, 
      responseType: 'stream',
      timeout: 60000
    });
    
    await new Promise((resolve, reject) => {
      response.data
        .pipe(fs.createWriteStream(inputPath))
        .on('finish', resolve)
        .on('error', reject);
    });

    // Extrae el frame en el segundo 2
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(2)
        .frames(1)
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // Devuelve base64
    const imageBase64 = fs.readFileSync(outputPath).toString('base64');
    
    res.json({ 
      imageBase64, 
      mimeType: 'image/jpeg' 
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    // Limpia los archivos temporales
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
