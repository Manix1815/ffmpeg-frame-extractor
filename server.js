const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');

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
// SIN CAMBIOS - extrae frame del segundo 2 para el caption de OpenAI
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
// NUEVO - convierte cualquier vídeo a MP4 H.264 1080x1920 y devuelve una URL
app.post('/process-video', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl es obligatorio' });

  const timestamp = Date.now();
  const inputPath = `/tmp/input_${timestamp}.mp4`;
  const outputFile = `processed_${timestamp}.mp4`;
  const outputPath = `/tmp/${outputFile}`;

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

    // Devuelve la URL donde Blotato puede descargar el vídeo procesado
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const processedVideoUrl = `${protocol}://${host}/video/${outputFile}`;

    // Limpia solo el input, el output se mantiene para que Blotato lo descargue
    cleanup(inputPath);

    // Auto-limpieza del vídeo procesado después de 10 minutos
    setTimeout(() => cleanup(outputPath), 10 * 60 * 1000);

    res.json({ processedVideoUrl });

  } catch (error) {
    cleanup(inputPath, outputPath);
    res.status(500).json({ error: error.message });
  }
});

// ─── /video/:filename ─────────────────────────────────────────────────────────
// NUEVO - sirve el vídeo procesado para que Blotato lo descargue
app.get('/video/:filename', (req, res) => {
  const filename = req.params.filename;
  
  // Seguridad: solo permite archivos processed_*.mp4
  if (!filename.match(/^processed_\d+\.mp4$/)) {
    return res.status(400).json({ error: 'Archivo no válido' });
  }

  const filePath = `/tmp/${filename}`;
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo no encontrado o expirado' });
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.sendFile(filePath);
});

// ─── /health ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
