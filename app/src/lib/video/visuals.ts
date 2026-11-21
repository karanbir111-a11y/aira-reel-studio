import fs from "fs";
import path from "path";

const IMAGE_MODEL = "gemini-2.5-flash-image";
const IMAGE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`;

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  return key;
}

// The renderer crops to 9:16 anyway, but asking for portrait up front avoids
// losing the subject to the crop.
const COMPOSITION = "Vertical 9:16 portrait composition. Photographic, cinematic lighting. No text, letters, numbers, logos or watermarks anywhere in the image.";

export async function generateSceneImage(
  visualPrompt: string,
  outPath: string,
  maxRetries = 3
): Promise<string> {
  const key = getApiKey();
  const prompt = `${visualPrompt}\n\n${COMPOSITION}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(`${IMAGE_URL}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "9:16" },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      throw new Error(`Gemini image error ${response.status}: ${text.slice(0, 400)}`);
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data);

    if (!imagePart) {
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      throw new Error(`Gemini returned no image: ${JSON.stringify(data).slice(0, 400)}`);
    }

    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), Buffer.from(imagePart.inlineData.data, "base64"));
    return path.resolve(outPath);
  }

  throw new Error("Gemini image generation failed after retries");
}

/**
 * Edit an existing image with a text instruction. Used to maintain the persona
 * reference set - distinguishing marks, wardrobe variants - without
 * regenerating the face from scratch and losing the identity.
 */
export async function editImage(
  sourcePath: string,
  instruction: string,
  outPath: string,
  maxRetries = 3
): Promise<string> {
  const key = getApiKey();
  const bytes = fs.readFileSync(path.resolve(sourcePath));
  const ext = path.extname(sourcePath).toLowerCase();
  const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(`${IMAGE_URL}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType, data: bytes.toString("base64") } },
              { text: instruction },
            ],
          },
        ],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      throw new Error(`Gemini edit error ${response.status}: ${text.slice(0, 400)}`);
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data);

    if (!imagePart) {
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      throw new Error(`Gemini edit returned no image: ${JSON.stringify(data).slice(0, 400)}`);
    }

    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), Buffer.from(imagePart.inlineData.data, "base64"));
    return path.resolve(outPath);
  }

  throw new Error("Gemini image edit failed after retries");
}

/**
 * Generate one image from several source images plus an instruction.
 *
 * Used to dress the persona in a client's product: the garment's colours and
 * embroidery survive far better when composited into a still that Veo then
 * animates, than when passed to Veo as a bare reference image.
 */
export async function composeImage(
  sourcePaths: string[],
  instruction: string,
  outPath: string,
  maxRetries = 3
): Promise<string> {
  const key = getApiKey();

  const parts: Record<string, unknown>[] = sourcePaths.map((p) => {
    const ext = path.extname(p).toLowerCase();
    return {
      inlineData: {
        mimeType: ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png",
        data: fs.readFileSync(path.resolve(p)).toString("base64"),
      },
    };
  });
  parts.push({ text: instruction });

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(`${IMAGE_URL}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      throw new Error(`Gemini compose error ${response.status}: ${text.slice(0, 400)}`);
    }

    const data = await response.json();
    const returned = data.candidates?.[0]?.content?.parts ?? [];
    const imagePart = returned.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data);

    if (!imagePart) {
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      throw new Error(`Gemini compose returned no image: ${JSON.stringify(data).slice(0, 400)}`);
    }

    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), Buffer.from(imagePart.inlineData.data, "base64"));
    return path.resolve(outPath);
  }

  throw new Error("Gemini image compose failed after retries");
}
