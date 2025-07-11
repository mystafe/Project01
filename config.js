// config.js
const config = {
  // --- Dosya ve Klasör Ayarları ---
  VIDEO_PATH: 'Input/sample-video.mp4',
  FRAMES_FOLDER: 'temp_frames',

  // --- Analiz Parametreleri ---
  BATCH_SIZE: 10,
  FRAME_INTERVAL_SECONDS: 12,             // DEĞİŞİKLİK: 10 saniyeden 12 saniyeye çıkarıldı.
  VIDEO_DURATION_LIMIT: '00:15:00',       // DEĞİŞİKLİK: Varsayılan süre 20 dakikaya düşürüldü.
  REQUEST_LIMIT: 4,

  // --- Tekrar Deneme Mekanizması Ayarları ---
  MAX_RETRIES: 3,
  INITIAL_DELAY_MS: 1000,
};

module.exports = config;