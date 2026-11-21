const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`;

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  return key;
}

// Gemini TTS returns headerless signed 16-bit little-endian PCM. Players and
// ffprobe need a RIFF header to read it, so wrap it before writing to disk.
function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

function sampleRateFromMime(mimeType: string | undefined): number {
  const match = /rate=(\d+)/.exec(mimeType ?? "");
  return match ? parseInt(match[1], 10) : 24000;
}

export async function synthesizeVoiceover(
  script: string,
  voiceName = "Kore",
  maxRetries = 3
): Promise<Buffer> {
  const key = getApiKey();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(`${TTS_URL}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: script }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      throw new Error(`Gemini TTS error ${response.status}: ${text}`);
    }

    const data = await response.json();
    const part = data.candidates?.[0]?.content?.parts?.[0];
    const b64 = part?.inlineData?.data;

    if (!b64) {
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      throw new Error(`Gemini TTS returned no audio: ${JSON.stringify(data).slice(0, 400)}`);
    }

    const pcm = Buffer.from(b64, "base64");
    return pcmToWav(pcm, sampleRateFromMime(part.inlineData.mimeType));
  }

  throw new Error("Gemini TTS failed after retries");
}
