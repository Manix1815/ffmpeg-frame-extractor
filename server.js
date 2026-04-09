const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

// ─── ENDPOINT ORIGINAL: solo extrae frame (se mantiene por compatibilidad) ───
app.post('/extract-frame', async (req, res) => {
  const { videoUrl } = req.body;
  
  if (!videoUrl) {
    return res.status(400).json({ error: 'videoUrl es obligatorio' });
  }

  const timestamp = Date.now();
  const inputPath = `/tmp/video_${timestamp}.mp4`;
  const outputPath = `/tmp/frame_${timestamp}.jpg`;

  try {
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

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(2)
        .frames(1)
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const imageBase64 = fs.readFileSync(outputPath).toString('base64');
    
    res.json({ 
      imageBase64, 
      mimeType: 'image/jpeg' 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
});

// ─── ENDPOINT COMBINADO: edita video + extrae fotograma ──────────────────────
// Devuelve: videoBase64 (video editado) + imageBase64 (frame para caption)
app.post('/process-video', async (req, res) => {
  const { videoUrl } = req.body;

  if (!videoUrl) {
    return res.status(400).json({ error: 'videoUrl es obligatorio' });
  }

  const timestamp  = Date.now();
  const inputPath  = `/tmp/input_${timestamp}.mp4`;
  const outputPath = `/tmp/output_${timestamp}.mp4`;
  const framePath  = `/tmp/frame_${timestamp}.jpg`;

  try {
    // 1. Descarga el video original
    const response = await axios({
      url: videoUrl,
      responseType: 'stream',
      timeout: 120000
    });

    await new Promise((resolve, reject) => {
      response.data
        .pipe(fs.createWriteStream(inputPath))
        .on('finish', resolve)
        .on('error', reject);
    });

    // 2. Obtiene duración para calcular el trim final
    const duration = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata.format.duration);
      });
    });

    const trimStart = 1;
    const trimEnd   = Math.max(trimStart + 1, duration - 1);

    // 3. Edita el video:
    //    - trim: quita 1s inicio y 1s final
    //    - setpts: ajusta timestamps + velocidad 101%
    //    - hflip: espejo horizontal
    //    - crop: recorta 3% de cada borde
    const videoFilter = [
      `trim=start=${trimStart}:end=${trimEnd}`,
      `setpts=(PTS-STARTPTS)/1.01`,
      `hflip`,
      `crop=iw*0.94:ih*0.94:(iw-iw*0.94)/2:(ih-ih*0.94)/2`
    ].join(',');

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoFilter(videoFilter)
        .audioFilter('atempo=1.01')
        .outputOptions([
          '-c:v libx264',
          '-crf 23',
          '-preset fast',
          '-c:a aac',
          '-movflags +faststart'
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // 4. Extrae fotograma del video YA EDITADO (segundo 2)
    await new Promise((resolve, reject) => {
      ffmpeg(outputPath)
        .seekInput(2)
        .frames(1)
        .output(framePath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // 5. Lee ambos archivos en base64
    const videoBase64 = fs.readFileSync(outputPath).toString('base64');
    const imageBase64 = fs.readFileSync(framePath).toString('base64');

    // 6. Devuelve todo junto
    res.json({
      videoBase64,
      videoMimeType: 'video/mp4',
      imageBase64,
      imageMimeType: 'image/jpeg'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    // Limpia todos los temporales
    if (fs.existsSync(inputPath))  fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (fs.existsSync(framePath))  fs.unlinkSync(framePath);
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
