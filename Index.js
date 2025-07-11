// index.js

require('dotenv').config();
const config = require('./config.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const ffmpeg = require('fluent-ffmpeg');
const fs = require("fs");
const path = require("path");
const readline = require('readline');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error("HATA: GOOGLE_API_KEY, .env dosyasında bulunamadı.");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

// --- YENİ: TAMAMEN LOKALLEŞTİRİLMİŞ ÇEVİRİ OBJESİ ---
const translations = {
  'English': {
    promptLanguage: "In which language should the analysis be generated? (e.g., English, Turkish, Español): ",
    defaulting: "No language provided. Defaulting to English.",
    languageConfirmed: (lang) => `Analysis report will be generated in: ${lang}.`,
    processing: (path, duration) => `Processing the first ${duration} of '${path}'...`,
    extracting: "Extracting frames... Time processed:",
    extractionComplete: "Frame extraction complete.",
    framesReady: (count) => `${count} frames are ready for analysis.`,
    startingAnalysis: "Starting cumulative analysis process...",
    preparingBatch: "Preparing the first batch of frames for the API (this may take a moment)...",
    analyzing: "Analyzing",
    elapsed: "Elapsed",
    eta: "ETA",
    apiOverloaded: (delay, attempt, max) => `API is overloaded (503). Retrying in ${delay}s... (Attempt ${attempt}/${max})`,
    unrecoverableError: "An unrecoverable API error occurred:",
    batchFailed: (max) => `Failed to process batch after ${max} attempts.`,
    limitReached: (limit) => `Request limit of ${limit} reached. Stopping analysis.`,
    finalReport: "--- FINAL CUMULATIVE ANALYSIS REPORT ---",
    framesDeleted: "Temporary frames have been deleted.",
    processError: "An error occurred during the process:",
    videoNotFound: (path) => `Error: Video file not found: '${path}'.`,
    noFramesExtracted: "No frames were extracted from the video."
  },
  'Turkish': {
    promptLanguage: "Analiz hangi dilde oluşturulsun? (Örn: Türkçe, English, Español): ",
    defaulting: "Dil belirtilmedi. Varsayılan olarak İngilizce seçildi.",
    languageConfirmed: (lang) => `Analiz raporu şu dilde oluşturulacak: ${lang}.`,
    processing: (path, duration) => `'${path}' dosyasının ilk ${duration} süresi işleniyor...`,
    extracting: "Kareler çıkarılıyor... İşlenen süre:",
    extractionComplete: "Kare çıkarma işlemi tamamlandı.",
    framesReady: (count) => `${count} adet kare analiz için hazırlandı.`,
    startingAnalysis: "Kümülatif analiz süreci başlatılıyor...",
    preparingBatch: "İlk kare grubu API için hazırlanıyor (bu işlem biraz sürebilir)...",
    analyzing: "Analiz ediliyor",
    elapsed: "Geçen Süre",
    eta: "Tahmini Kalan Süre",
    apiOverloaded: (delay, attempt, max) => `API aşırı yüklü (503). ${delay} saniye içinde tekrar denenecek... (Deneme ${attempt}/${max})`,
    unrecoverableError: "Kurtarılamayan bir API hatası oluştu:",
    batchFailed: (max) => `Grup, ${max} deneme sonunda işlenemedi.`,
    limitReached: (limit) => `${limit} olan istek limitine ulaşıldı. Analiz durduruluyor.`,
    finalReport: "--- NİHAİ KÜMÜLATİF ANALİZ RAPORU ---",
    framesDeleted: "Geçici kareler silindi.",
    processError: "Süreç boyunca bir hata meydana geldi:",
    videoNotFound: (path) => `Hata: Video dosyası bulunamadı: '${path}'.`,
    noFramesExtracted: "Videodan hiç kare çıkarılamadı."
  }, 'Türkçe': {
    promptLanguage: "Analiz hangi dilde oluşturulsun? (Örn: Türkçe, English, Español): ",
    defaulting: "Dil belirtilmedi. Varsayılan olarak İngilizce seçildi.",
    languageConfirmed: (lang) => `Analiz raporu şu dilde oluşturulacak: ${lang}.`,
    processing: (path, duration) => `'${path}' dosyasının ilk ${duration} süresi işleniyor...`,
    extracting: "Kareler çıkarılıyor... İşlenen süre:",
    extractionComplete: "Kare çıkarma işlemi tamamlandı.",
    framesReady: (count) => `${count} adet kare analiz için hazırlandı.`,
    startingAnalysis: "Kümülatif analiz süreci başlatılıyor...",
    preparingBatch: "İlk kare grubu API için hazırlanıyor (bu işlem biraz sürebilir)...",
    analyzing: "Analiz ediliyor",
    elapsed: "Geçen Süre",
    eta: "Tahmini Kalan Süre",
    apiOverloaded: (delay, attempt, max) => `API aşırı yüklü (503). ${delay} saniye içinde tekrar denenecek... (Deneme ${attempt}/${max})`,
    unrecoverableError: "Kurtarılamayan bir API hatası oluştu:",
    batchFailed: (max) => `Grup, ${max} deneme sonunda işlenemedi.`,
    limitReached: (limit) => `${limit} olan istek limitine ulaşıldı. Analiz durduruluyor.`,
    finalReport: "--- NİHAİ KÜMÜLATİF ANALİZ RAPORU ---",
    framesDeleted: "Geçici kareler silindi.",
    processError: "Süreç boyunca bir hata meydana geldi:",
    videoNotFound: (path) => `Hata: Video dosyası bulunamadı: '${path}'.`,
    noFramesExtracted: "Videodan hiç kare çıkarılamadı."
  }
};

// --- Yardımcı fonksiyonlar (değişiklik yok) ---
function fileToGenerativePart(filePath, mimeType) {
  try {
    const data = fs.readFileSync(filePath).toString("base64");
    return { inlineData: { data, mimeType } };
  } catch (error) {
    console.error(`Hata: ${filePath} dosyası okunamadı.`, error);
    return null;
  }
}
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const formatDuration = (seconds) => {
  if (!isFinite(seconds)) return 'N/A';
  return new Date(seconds * 1000).toISOString().substr(11, 8);
};
const printAnalysisProgress = (processed, total, startTime, T) => {
  const percentage = Math.floor((processed / total) * 100);
  const progressBarLength = 30;
  const filledLength = Math.round(progressBarLength * (percentage / 100));
  const bar = '█'.repeat(filledLength) + ' '.repeat(progressBarLength - filledLength);
  const elapsedTime = (performance.now() - startTime) / 1000;
  const itemsPerSecond = processed / elapsedTime;
  const etaSeconds = (total - processed) / itemsPerSecond;
  const eta = formatDuration(etaSeconds);
  process.stdout.write(`${T.analyzing}: [${bar}] ${percentage}% | ${processed}/${total} | ${T.elapsed}: ${formatDuration(elapsedTime)} | ${T.eta}: ${eta}\r`);
};

async function analyzeVideo(outputLanguage, T) {
  let finalCumulativeAnalysis = "";
  let requestsSent = 0;

  if (!fs.existsSync(config.VIDEO_PATH)) {
    console.error(T.videoNotFound(config.VIDEO_PATH));
    return;
  }
  if (!fs.existsSync(config.FRAMES_FOLDER)) fs.mkdirSync(config.FRAMES_FOLDER);
  else {
    fs.readdirSync(config.FRAMES_FOLDER).forEach(file => fs.unlinkSync(path.join(config.FRAMES_FOLDER, file)));
  }

  console.log(T.processing(config.VIDEO_PATH, config.VIDEO_DURATION_LIMIT));

  await new Promise((resolve, reject) => {
    ffmpeg(config.VIDEO_PATH)
      .on('progress', (progress) => {
        process.stdout.write(`${T.extracting} [${progress.timemark}] \r`);
      })
      .on('end', () => {
        process.stdout.write(`\n${T.extractionComplete}\n`);
        resolve();
      })
      .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
      .output(path.join(config.FRAMES_FOLDER, 'frame-%d.png'))
      .outputOptions(`-vf`, `fps=1/${config.FRAME_INTERVAL_SECONDS}`)
      .duration(config.VIDEO_DURATION_LIMIT)
      .run();
  });

  const frameFiles = fs.readdirSync(config.FRAMES_FOLDER)
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  if (frameFiles.length === 0) {
    console.error(T.noFramesExtracted);
    return;
  }
  console.log(T.framesReady(frameFiles.length));

  // const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const chat = model.startChat({ history: [] });

  const totalBatchesToSend = Math.min(config.REQUEST_LIMIT, Math.ceil(frameFiles.length / config.BATCH_SIZE));
  const analysisStartTime = performance.now();
  console.log(T.startingAnalysis);
  console.log(T.preparingBatch); // YENİ: Bekleme bilgilendirmesi

  for (let i = 0; i < frameFiles.length; i += config.BATCH_SIZE) {
    if (requestsSent >= config.REQUEST_LIMIT) {
      console.log(`\n${T.limitReached(config.REQUEST_LIMIT)}`);
      break;
    }

    const batchFiles = frameFiles.slice(i, i + config.BATCH_SIZE);
    const imageParts = batchFiles.map(file =>
      fileToGenerativePart(path.join(config.FRAMES_FOLDER, file), "image/png")
    ).filter(part => part !== null);
    if (imageParts.length === 0) continue;

    let promptText;
    if (requestsSent === 0) {
      // --- İLK İSTEK İÇİN PROMPT (EN DETAYLI) ---
      promptText = `
          **EN ÖNEMLİ KURAL: CEVABIN TAMAMI, İSTİSNASIZ OLARAK, SADECE BU DİLDE OLUŞTURULMALIDIR: "${outputLanguage}"**

          Sen son derece yetenekli bir toplantı analizi yapay zekasısın. Görevin, bu ilk video karelerini analiz etmek ve aşağıda belirtilen formatta, Markdown kullanarak kapsamlı ve profesyonel bir rapor sunmaktır.

          **İSİM KURALI:** Tespit ettiğin her bir kişiye, rapor boyunca tutarlı bir şekilde kullanacağın, "Katılımcı 1 (tanım)", "Katılımcı 2 (tanım)" gibi benzersiz etiketler ata.
          
          Bu görsellere dayanarak, lütfen aşağıdaki başlıkları doldur:
          1.  **Yönetici Özeti:** Gözlemlerinin tamamını özetleyen 1-2 cümlelik kısa paragraf.
          2.  **Katılımcılar:** Tespit ettiğin ve etiket atadığın tüm kişileri listele.
          3.  **Konuşma Deşifresi:** Konuşma çıkarımı yapabiliyorsan, deşifre et.
          4.  **Duygu Analizi:** Toplantının genel havasını ve katılımcıların vücut dilini yorumla.
          5.  **Önemli Aksiyonlar ve Olaylar:** Gözlemlediğin en önemli eylemleri madde madde listele.
          6.  **Aksiyon Maddeleri:** Çıkarım yapabildiğin "yapılacaklar listesi" veya "alınan kararlar" varsa listele.
          7.  **Gözlemlenen Ortam:** Ortamı ve önemli nesneleri tarif et.`;
    } else {
      // --- SONRAKİ İSTEKLER İÇİN PROMPT (GÜNCELLEME) ---
      promptText = `
          **EN ÖNEMLİ KURAL: CEVABIN TAMAMI, İSTİSNASIZ OLARAK, SADECE BU DİLDE OLUŞTURULMALIDIR: "${outputLanguage}"**
          
          Mevcut analizimiz mükemmel. Şimdi, aynı videonun devamı olan bu yeni kareleri kullanarak o analizi **güncelle ve zenginleştir**. Yeni olayları, kararları veya duygu değişimlerini mevcut rapora ekle. Raporun tek, kümülatif ve tutarlı bir bütün olarak kalmasını sağla. Daha önce atadığın "Katılımcı 1" gibi etiketleri kullanmaya devam et.`;
    }

    const promptParts = [{ text: promptText }, ...imageParts];

    let success = false;
    for (let attempt = 1; attempt <= config.MAX_RETRIES; attempt++) {
      try {
        const result = await chat.sendMessage(promptParts);
        finalCumulativeAnalysis = result.response.text();
        requestsSent++;
        success = true;
        printAnalysisProgress(requestsSent, totalBatchesToSend, analysisStartTime, T);
        break;
      } catch (error) {
        const isOverloaded = error.message && error.message.includes('503');
        if (attempt < config.MAX_RETRIES && isOverloaded) {
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          const waitTime = config.INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(T.apiOverloaded(waitTime / 1000, attempt, config.MAX_RETRIES));
          await delay(waitTime);
        } else {
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          console.error(T.unrecoverableError, error.message);
          break;
        }
      }
    }
    if (!success) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      console.error(T.batchFailed(config.MAX_RETRIES));
    }
  }

  console.log(`\n\n${T.finalReport}`);
  console.log(finalCumulativeAnalysis);
  console.log("-------------------------------------------");

  fs.readdirSync(config.FRAMES_FOLDER).forEach(file => fs.unlinkSync(path.join(config.FRAMES_FOLDER, file)));
  console.log(`\n${T.framesDeleted}`);
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

  try {
    const languageInput = await askQuestion(translations['Turkish'].promptLanguage); // Soruyu varsayılan olarak Türkçe sor
    let languageKey = languageInput.trim();
    let T;

    if (!languageKey) {
      console.log(translations['Turkish'].defaulting); // Varsayılan bilgilendirmeyi Türkçe yap
      T = translations['English'];
      languageKey = 'English';
    } else {
      const foundKey = Object.keys(translations).find(key => key.toLowerCase() === languageKey.toLowerCase());
      T = translations[foundKey] || translations['English']; // Bulunamazsa İngilizce'ye dön
      languageKey = foundKey || 'English';
    }

    console.log(T.languageConfirmed(languageKey)); // YENİ: Seçilen dili doğrula
    await analyzeVideo(languageKey, T);

  } catch (error) {
    console.error(translations['Turkish'].processError, error);
  } finally {
    rl.close();
  }
}

main();