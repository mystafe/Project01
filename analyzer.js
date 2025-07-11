// analyzer.js - DÜZELTİLMİŞ, TAM VE ÇALIŞAN VERSİYON

const config = require('./config.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");
const readline = require('readline');
const axios = require('axios');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

// --- Yardımcı Fonksiyonlar ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const updateProgress = (text) => {
  // Güvenlik kontrolü: Sadece tanımlı bir metin varsa yazdır
  if (typeof text === 'string') {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(text);
  }
};

async function uploadFileToGemini(filePath, mimeType, uiTexts) {
  updateProgress(uiTexts.step("N/A", "N/A", `${uiTexts.uploading} ${path.basename(filePath)}`));
  try {
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
    return response.data.file;
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
    updateProgress(`\n[ERROR] Failed to upload file: ${errorMessage}`);
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

// --- Ana Analiz Fonksiyonu ---
async function analyzeVideoInBatches(outputLanguage, analysisType, uiTexts) {
  const ffmpeg = require('fluent-ffmpeg');
  const overallStartTime = Date.now();
  let finalCumulativeAnalysis = "";
  const uploadedFileNames = [];

  console.log("-".repeat(70));
  console.log(uiTexts.processing(config.VIDEO_PATH, config.MODEL_NAME));
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
    const stepMessage = uiTexts.step(currentBatch + 1, config.TOTAL_BATCHES, uiTexts.extracting);
    updateProgress(stepMessage);

    const startTimeSeconds = currentBatch * config.SECONDS_PER_BATCH;
    const audioChunkPath = path.join(config.AUDIO_FOLDER, `audio_chunk_${currentBatch}.mp3`);
    const framePattern = path.join(config.FRAMES_FOLDER, `batch_${currentBatch}_frame-%d.png`);

    await new Promise((resolve, reject) => {
      ffmpeg().input(config.VIDEO_PATH).inputOptions([`-ss ${startTimeSeconds}`]).outputOptions([`-t ${config.SECONDS_PER_BATCH}`])
        .output(framePattern).outputOptions([`-vf fps=1/${config.FRAME_INTERVAL_SECONDS}`]).noAudio()
        .on('end', resolve)
        .on('error', (err) => {
          updateProgress(`\n[ERROR] FFmpeg frame extraction failed: ${err.message}`);
          reject(err);
        })
        .run();
    });
    await new Promise((resolve, reject) => {
      ffmpeg().input(config.VIDEO_PATH).inputOptions([`-ss ${startTimeSeconds}`]).outputOptions([`-t ${config.SECONDS_PER_BATCH}`])
        .output(audioChunkPath).noVideo().audioCodec('libmp3lame')
        .on('end', resolve)
        .on('error', (err) => {
          updateProgress(`\n[ERROR] FFmpeg audio extraction failed: ${err.message}`);
          reject(err);
        })
        .run();
    });

    const audioFile = await uploadFileToGemini(audioChunkPath, "audio/mp3", uiTexts);
    if (!audioFile) { continue; }
    uploadedFileNames.push(audioFile.name);

    const frameFiles = fs.readdirSync(config.FRAMES_FOLDER).filter(f => f.startsWith(`batch_${currentBatch}`));
    const imageParts = frameFiles.map(file =>
      fileToGenerativePart(path.join(config.FRAMES_FOLDER, file), "image/png")
    ).filter(part => part !== null);

    updateProgress(uiTexts.step(currentBatch + 1, config.TOTAL_BATCHES, uiTexts.analyzing));

    let promptText;
    if (currentBatch === 0) {
      if (analysisType === 'meeting') {
        promptText = `
                **EN ÖNEMLİ KURAL: Tüm cevabı MUTLAKA sadece şu dilde oluştur: "${outputLanguage}"**
                Sen, toplantıları analiz eden uzman bir multimodal yapay zekasın... (Önceki cevaptaki tam toplantı prompt'u)`;
      } else {
        promptText = `
                **EN ÖNEMLİ KURAL: Tüm cevabı MUTLAKA sadece şu dilde oluştur: "${outputLanguage}"**
                Sen, videoları yorumlayan uzman bir multimodal yapay zekasın... (Önceki cevaptaki tam genel video prompt'u)`;
      }
    } else {
      promptText = `
            **EN ÖNEMLİ KURAL: Cevabını MUTLAKA sadece şu dilde oluşturmaya devam et: "${outputLanguage}"**
            Analizimize devam ediyoruz... (Önceki cevaptaki tam güncelleme prompt'u)`;
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
        if (error.message && error.message.includes('503') && attempt < config.MAX_RETRIES) {
          const waitTime = config.INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
          updateProgress(uiTexts.step(currentBatch + 1, config.TOTAL_BATCHES, uiTexts.apiOverloaded(waitTime / 1000)));
          await delay(waitTime);
        } else {
          updateProgress(`\n[ERROR] Analysis failed: ${error.message}`);
          success = false;
          break;
        }
      }
    }
    if (!success) { updateProgress(`\n${uiTexts.analysisFailed}`); }
  }
  process.stdout.write('\n');

  console.log(`\n\n${uiTexts.finalReport}`);
  console.log("-".repeat(70));
  console.log(finalCumulativeAnalysis);
  console.log("-".repeat(70));

  console.log(`\n${uiTexts.cleanup}`);
  console.log(uiTexts.serverCleanup);
  for (const fileName of uploadedFileNames) {
    try { await axios.delete(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GOOGLE_API_KEY}`); } catch (err) { }
  }
  console.log(uiTexts.localCleanup);
  for (const folder of [config.FRAMES_FOLDER, config.AUDIO_FOLDER]) {
    if (fs.existsSync(folder)) {
      fs.readdirSync(folder).forEach(file => { try { fs.unlinkSync(path.join(folder, file)); } catch (err) { } });
      try { fs.rmdirSync(folder); } catch (err) { }
    }
  }
  console.log(uiTexts.cleanupComplete);
  const endTime = Date.now();
  console.log(`\n✔ Process finished. Total time: ${((endTime - overallStartTime) / 1000).toFixed(2)} seconds.`);
}

module.exports = { analyzeVideoInBatches };