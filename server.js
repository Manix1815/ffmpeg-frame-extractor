const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ─── Utilidad: descarga un vídeo a /tmp ───────────────────────────────────────
async function downloadFile(url, destPath) {
  const response = await axios({
    url,
    responseType: 'stream',
    timeout: 120000
  });
  await new Promise((resolve, reject) => {
    response.data
      .pipe(fs.createWriteStream(destPath))
      .on('finish', resolve)
      .on('error', reject);
  });
}

// ─── Utilidad: limpia archivos temporales ─────────────────────────────────────
function cleanup(...paths) {
  for (const p of paths) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }
}

// ─── /extract-frame ───────────────────────────────────────────────────────────
// Extrae el frame del segundo 2 como JPG base64 (para thumbnail/caption)
app.post('/extract-frame', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl es obligatorio' });

  const timestamp = Date.now();
  const inputPath = `/tmp/video_${timestamp}.mp4`;
  const outputPath = `/tmp/frame_${timestamp}.jpg`;

  try {
    await downloadFile(videoUrl, inputPath);

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
    res.json({ imageBase64, mimeType: 'image/jpeg' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    cleanup(inputPath, outputPath);
  }
});

// ─── /process-video ───────────────────────────────────────────────────────────
// Convierte cualquier vídeo a MP4 H.264 1080x1920 (9:16) listo para Instagram Reels
app.post('/process-video', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl es obligatorio' });

  const timestamp = Date.now();
  const inputPath = `/tmp/input_${timestamp}.mp4`;
  const outputPath = `/tmp/output_${timestamp}.mp4`;

  try {
    await downloadFile(videoUrl, inputPath);

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoFilter([
          'scale=1080:1920:force_original_aspect_ratio=increase',
          'crop=1080:1920'
        ])
        .videoCodec('libx264')
        .addOption('-crf', '23')
        .addOption('-preset', 'fast')
        .addOption('-movflags', '+faststart')
        .audioCodec('aac')
        .audioBitrate('128k')
        .fps(30)
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const videoBase64 = fs.readFileSync(outputPath).toString('base64');
    res.json({ videoBase64, mimeType: 'video/mp4' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    cleanup(inputPath, outputPath);
  }
});

// ─── /health ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
