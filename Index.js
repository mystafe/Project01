// index.js - Kullanıcı Arayüzü ve Başlatıcı

require('dotenv').config();
const { analyzeVideoInBatches } = require('./analyzer.js');
const readline = require('readline');

// Arayüz metinleri
const UI_TEXTS = {
  languagePrompt: "In which language should the report be generated? (e.g., Turkish, English): ",
  analysisTypePrompt: "Select analysis type: [1] Meeting Analysis [2] General Video Analysis: ",
  languageConfirmed: (lang) => `✔ Language confirmed: ${lang}.`,
  analysisTypeConfirmed: (type) => `✔ Analysis type confirmed: ${type}.`,
  unsupportedLanguage: (lang, defaultLang) => `❌ '${lang}' is not a supported language. Defaulting to ${defaultLang}.`,
  noLanguage: (defaultLang) => `✔ No language entered. Defaulting to ${defaultLang}.`,
  processing: (path, model) => `▶ Analyzing '${path}' with "${model}" model...`,
  step: (current, total, message) => `[${current}/${total}] ${message}`,
  extracting: "Extracting media chunks...",
  uploading: "Uploading media...",
  analyzing: "Performing cumulative analysis...",
  finalReport: "--- FINAL CUMULATIVE ANALYSIS REPORT ---",
  cleanup: "\nCleaning up...",
  serverCleanup: "  ↪ Deleting temporary audio file(s) from server...",
  localCleanup: "  ↪ Deleting local temporary files...",
  cleanupComplete: "✔ Cleanup complete.",
  error: "An error occurred during the process:",
  apiOverloaded: (delay) => `API is overloaded. Retrying in ${delay}s...`,
  analysisFailed: "Analysis failed after multiple retries."
};

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));
  let analysisType = 'meeting';

  try {
    const typeInput = await askQuestion(UI_TEXTS.analysisTypePrompt);
    if (typeInput.trim() === '2') {
      analysisType = 'general';
    }
    console.log(UI_TEXTS.analysisTypeConfirmed(analysisType));

    const languageInput = await askQuestion(UI_TEXTS.languagePrompt);
    let languageToUse = 'English'; // Varsayılan

    if (languageInput.trim().toLowerCase().startsWith('tur')) {
      languageToUse = 'Turkish';
    } else if (languageInput.trim() !== '' && !languageInput.trim().toLowerCase().startsWith('eng')) {
      console.log(UI_TEXTS.unsupportedLanguage(languageInput.trim(), 'English'));
    } else if (!languageInput.trim()) {
      console.log(UI_TEXTS.noLanguage('English'));
    }

    console.log(UI_TEXTS.languageConfirmed(languageToUse));

    await analyzeVideoInBatches(languageToUse, analysisType, UI_TEXTS);

  } catch (error) {
    console.error(UI_TEXTS.error, error);
  } finally {
    rl.close();
  }
}

main();