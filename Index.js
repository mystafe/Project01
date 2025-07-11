// index.js - NIHAI, TAM VE DOĞRU TEMİZLİK MANTIĞIYLA

require('dotenv').config();
const config = require('./config.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");
const readline = require('readline');
const axios = require('axios');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error("ERROR: GOOGLE_API_KEY not found in .env file.");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

const LOG_MESSAGES = {
  languagePrompt: "In which language should the analysis report be generated? (e.g., Turkish, English): ",
  languageConfirmed: (lang) => `✔ Language confirmed: Analysis report will be generated in ${lang}.`,
  unsupportedLanguage: (lang, defaultLang) => `❌ '${lang}' is not a supported language. Defaulting to ${defaultLang}.`,
  noLanguage: (defaultLang) => `✔ No language entered. Defaulting to ${defaultLang}.`,
  processing: (path, batches, seconds, model) => `▶ Starting: Analyzing '${path}' in ${batches} batch(es) of ${seconds} seconds each, using "${model}" model.`,
  step: (current, total) => `Step ${current}/${total}: Processing Media Batch`,
  extractingFrames: "  ↪ Extracting video frames...",
  extractingAudio: "  ↪ Extracting audio clip...",
  extractionComplete: "  ✔ Media extraction complete.",
  uploadingAudio: "  ↪ Uploading audio file to Gemini:",
  audioUploadSuccess: "  ✔ Upload successful.",
  analyzingBatch: "  ↪ Performing cumulative analysis with Gemini...",
  finalReport: "--- FINAL CUMULATIVE MEETING ANALYSIS REPORT ---",
  cleanup: "Cleaning up...",
  serverCleanup: "  ↪ Deleting temporary audio files from server...",
  localCleanup: "  ↪ Deleting local temporary files...",
  cleanupComplete: "✔ Cleanup complete.",
  error: "An error occurred during the process:",
  fileUploadError: "ERROR: Audio file upload failed, skipping this batch.",
  apiOverloaded: (delay, attempt, max) => `  ↪ API is overloaded (503). Retrying in ${delay}s... (Attempt ${attempt}/${max})`,
  analysisFailed: (max) => `  ↪ Analysis failed after ${max} attempts.`
};

// --- Yardımcı Fonksiyonlar ---
async function uploadFileToGemini(filePath, mimeType) {
  try {
    console.log(LOG_MESSAGES.uploadingAudio, path.basename(filePath));
    const stats = fs.statSync(filePath);
    const fileSizeInBytes = stats.size;
    const fileData = fs.readFileSync(filePath);

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GOOGLE_API_KEY}`,
      fileData,
      {
        headers: {
          'Content-Type': mimeType,
          'x-goog-upload-protocol': 'raw',
          'x-goog-file-name': path.basename(filePath),
          'Content-Length': fileSizeInBytes.toString()
        }
      }
    );
    console.log(LOG_MESSAGES.audioUploadSuccess);
    return response.data.file;
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`\n[ERROR] Failed to upload file via REST API: ${filePath}. Reason: ${errorMessage}`);
    return null;
  }
}

function fileToGenerativePart(filePath, mimeType) {
  try {
    const data = fs.readFileSync(filePath).toString("base64");
    return { inlineData: { data, mimeType } };
  } catch (error) {
    console.error(`Error: Could not read file ${filePath}.`, error);
    return null;
  }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Ana Analiz Fonksiyonu ---
async function analyzeVideoInBatches(outputLanguage) {
  const ffmpeg = require('fluent-ffmpeg');
  const overallStartTime = Date.now();
  let finalCumulativeAnalysis = "";
  const uploadedFileNames = []; // Yüklenen dosyaların adlarını saklamak için dizi

  console.log("-".repeat(70));
  console.log(LOG_MESSAGES.processing(config.VIDEO_PATH, config.TOTAL_BATCHES, config.SECONDS_PER_BATCH, config.MODEL_NAME));
  console.log("-".repeat(70));

  for (const folder of [config.FRAMES_FOLDER, config.AUDIO_FOLDER]) {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);
    else {
      fs.readdirSync(folder).forEach(file => { try { fs.unlinkSync(path.join(folder, file)); } catch (err) { } });
    }
  }

  const model = genAI.getGenerativeModel({ model: config.MODEL_NAME });
  const chat = model.startChat({ history: [] });

  for (let currentBatch = 0; currentBatch < config.TOTAL_BATCHES; currentBatch++) {
    console.log(`\n${LOG_MESSAGES.step(currentBatch + 1, config.TOTAL_BATCHES)}`);

    const startTimeSeconds = currentBatch * config.SECONDS_PER_BATCH;
    const audioChunkPath = path.join(config.AUDIO_FOLDER, `audio_chunk_${currentBatch}.mp3`);
    const framePattern = path.join(config.FRAMES_FOLDER, `batch_${currentBatch}_frame-%d.png`);

    console.log(LOG_MESSAGES.extractingFrames);
    await new Promise((resolve, reject) => {
      ffmpeg(config.VIDEO_PATH)
        .inputOptions([`-ss ${startTimeSeconds}`])
        .outputOptions([`-t ${config.SECONDS_PER_BATCH}`])
        .output(framePattern)
        .outputOptions([`-vf fps=1/${config.FRAME_INTERVAL_SECONDS}`])
        .noAudio()
        .on('end', resolve)
        .on('error', (err) => {
          console.error('\nFFmpeg frame extraction error:', err.message);
          reject(err);
        })
        .run();
    });

    console.log(LOG_MESSAGES.extractingAudio);
    await new Promise((resolve, reject) => {
      ffmpeg(config.VIDEO_PATH)
        .inputOptions([`-ss ${startTimeSeconds}`])
        .outputOptions([`-t ${config.SECONDS_PER_BATCH}`])
        .output(audioChunkPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .on('end', resolve)
        .on('error', (err) => {
          console.error('\nFFmpeg audio extraction error:', err.message);
          reject(err);
        })
        .run();
    });
    console.log(LOG_MESSAGES.extractionComplete);

    const audioFile = await uploadFileToGemini(audioChunkPath, "audio/mp3");
    if (!audioFile) {
      console.error(LOG_MESSAGES.fileUploadError);
      continue;
    }
    uploadedFileNames.push(audioFile.name); // Başarıyla yüklenen dosyanın adını listeye ekle

    const frameFiles = fs.readdirSync(config.FRAMES_FOLDER).filter(f => f.startsWith(`batch_${currentBatch}`));
    const imageParts = frameFiles.map(file =>
      fileToGenerativePart(path.join(config.FRAMES_FOLDER, file), "image/png")
    ).filter(part => part !== null);

    console.log(LOG_MESSAGES.analyzingBatch);
    let promptText;
    if (currentBatch === 0) {
      promptText = `
            **EN ÖNEMLİ KURAL: Tüm cevabı MUTLAKA sadece şu dilde oluştur: "${outputLanguage}"**

            Sen, toplantıları analiz eden uzman bir multimodal yapay zekasın. Sana bir online toplantının ilk bölümüne ait video kareleri ve ses kaydını gönderiyorum. Görevin, her iki veri türünü de kullanarak, aşağıda belirtilen formatta, profesyonel ve detaylı bir toplantı notu oluşturmaktır.

            **KATILIMCI KURALI:** Tespit ettiğin her bir kişiye, rapor boyunca tutarlı olacak şekilde "Katılımcı 1 (kısa tanım, örn: mavi gömlekli)", "Katılımcı 2 (gözlüklü)" gibi benzersiz etiketler ata.
            
            Lütfen aşağıdaki başlıkları doldur:
            1.  **Yönetici Özeti (Executive Summary):** Bu bölümdeki en önemli gelişmeleri ve tartışmaları 2-3 cümleyle özetle.
            2.  **Katılımcılar (Participants):** Tespit ettiğin ve etiket atadığın tüm kişileri listele.
            3.  **Toplantı Deşifresi (Full Transcript):** Ses kaydından duyduğun tüm konuşmayı, konuşmacı etiketlerini belirterek deşifre et. (Örn: "Katılımcı 1: ...")
            4.  **Duygu Analizi (Sentiment Analysis):** Konuşmacıların ses tonu ve vücut diline dayanarak toplantının genel atmosferini (örn: yapıcı, gergin, enerjik) ve kilit anlardaki duygusal değişimleri yorumla.
            5.  **Ana Tartışma Konuları (Key Discussion Points):** Konuşulan ana başlıkları madde madde listele.
            6.  **Alınan Kararlar (Decisions Made):** Toplantıda net bir şekilde alınan kararları listele.
            7.  **Aksiyon Maddeleri (Action Items):** Kimin ne yapması gerektiğine dair ortaya çıkan görevleri, sorumlu kişiyi belirterek listele. (Örn: "Aksiyon: Pazarlama raporunu hazırlamak. - Sorumlu: Katılımcı 2")
            8.  **Anahtar Kelimeler (Keywords):** Toplantıda sıkça geçen önemli terimleri ve anahtar kelimeleri belirt.`;
    } else {
      promptText = `
            **EN ÖNEMLİ KURAL: Cevabını MUTLAKA sadece şu dilde oluşturmaya devam et: "${outputLanguage}"**
            
            Analizimize devam ediyoruz. İşte toplantının bir sonraki bölümüne ait yeni video kareleri ve ses kaydı. Lütfen bu yeni verileri kullanarak daha önce oluşturduğun kümülatif raporu **güncelle, detaylandır ve zenginleştir**. Yeni tartışmaları, kararları veya aksiyon maddelerini mevcut rapora ekle. Raporun tek bir bütün olarak kalmasını ve tutarlılığını korumasını sağla.`;
    }

    const audioPart = { fileData: { mimeType: audioFile.mimeType, fileUri: audioFile.uri } };
    const promptParts = [promptText, ...imageParts, audioPart];

    let success = false;
    for (let attempt = 1; attempt <= config.MAX_RETRIES; attempt++) {
      try {
        const result = await chat.sendMessage(promptParts);
        finalCumulativeAnalysis = result.response.text();
        success = true;
        break;
      } catch (error) {
        const isOverloaded = error.message && error.message.includes('503');
        if (attempt < config.MAX_RETRIES && isOverloaded) {
          const waitTime = config.INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(LOG_MESSAGES.apiOverloaded(waitTime / 1000, attempt, config.MAX_RETRIES));
          await delay(waitTime);
        } else {
          console.error(`\n[ERROR] An issue occurred during Gemini analysis: ${error.message}`);
          success = false;
          break;
        }
      }
    }
    if (!success) {
      console.error(`\n${LOG_MESSAGES.analysisFailed(config.MAX_RETRIES)}`);
    } else {
      console.log(`✔ Batch ${currentBatch + 1}/${config.TOTAL_BATCHES} complete.`);
    }

    // DÖNGÜ İÇİNDEKİ SİLME İŞLEMİ KALDIRILDI
  }

  console.log(`\n\n${LOG_MESSAGES.finalReport}`);
  console.log("-".repeat(70));
  console.log(finalCumulativeAnalysis);
  console.log("-".repeat(70));

  console.log(`\n${LOG_MESSAGES.cleanup}`);

  // YENİ: TÜM ANALİZ BİTTİKTEN SONRA TOPLU SUNUCU TEMİZLİĞİ
  console.log(LOG_MESSAGES.serverCleanup);
  for (const fileName of uploadedFileNames) {
    try {
      await axios.delete(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GOOGLE_API_KEY}`);
    } catch (err) {
      console.warn(`Warning: Could not delete file ${fileName} from server. It may be auto-deleted later.`);
    }
  }

  console.log(LOG_MESSAGES.localCleanup);
  for (const folder of [config.FRAMES_FOLDER, config.AUDIO_FOLDER]) {
    if (fs.existsSync(folder)) {
      fs.readdirSync(folder).forEach(file => { try { fs.unlinkSync(path.join(folder, file)); } catch (err) { } });
      try { fs.rmdirSync(folder); } catch (err) { }
    }
  }
  console.log(LOG_MESSAGES.cleanupComplete);
  const endTime = Date.now();
  console.log(`\n✔ Process finished. Total time: ${((endTime - overallStartTime) / 1000).toFixed(2)} seconds.`);
}

// --- Ana Başlatma Fonksiyonu ---
async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

  try {
    const languageInput = await askQuestion(LOG_MESSAGES.languagePrompt);
    let languageToUse = 'English'; // Varsayılan İngilizce

    const supportedLanguages = {
      'turkish': 'Turkish',
      'türkçe': 'Turkish',
      'english': 'English'
    };
    const normalizedInput = languageInput.trim().toLowerCase();

    if (supportedLanguages[normalizedInput]) {
      languageToUse = supportedLanguages[normalizedInput];
    } else if (normalizedInput !== '') {
      console.log(LOG_MESSAGES.unsupportedLanguage(languageInput.trim(), 'English'));
    } else {
      console.log(LOG_MESSAGES.noLanguage('English'));
    }

    console.log(LOG_MESSAGES.languageConfirmed(languageToUse));
    await analyzeVideoInBatches(languageToUse);

  } catch (error) {
    console.error(LOG_MESSAGES.error, error);
  } finally {
    rl.close();
  }
}

main();