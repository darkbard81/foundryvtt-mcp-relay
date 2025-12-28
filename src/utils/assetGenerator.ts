import { GoogleGenAI } from '@google/genai';
import mime from 'mime';
import { writeFile } from 'fs';
import crypto from 'crypto';
import { log } from '../utils/logger.js';
import { URL } from 'node:url';
import { cfg } from '../config.js';
import path from "path";
import sharp from 'sharp';
import { VoiceActor, StyleTone } from '../types/types.js';

export enum AspectRatio {
    R1_1 = "1:1",
    R2_3 = "2:3",
    R3_2 = "3:2",
    R3_4 = "3:4",
    R4_3 = "4:3",
    R9_16 = "9:16",
    R16_9 = "16:9",
    R21_9 = "21:9",
}

/**
 * Returns a singleton GoogleGenAI client or null when the API key is missing.
 * Always checks the configured key before attempting initialization.
 * @returns GoogleGenAI client instance, or null when unavailable.
 */
export function getGenAI(): GoogleGenAI | null {
    try {
        return new GoogleGenAI({ apiKey: cfg.GOOGLE_GENAI_API_KEY });
    } catch (err: unknown) {
        const meta = err instanceof Error
            ? { message: err.message, stack: err.stack }
            : { err };
        log.error('Failed to initialize GoogleGenAI client', meta);
        return null;
    }
}

/**
 * Persists binary content to disk and logs success or failure.
 * @param fileName Relative path to save the file under `tts_output`.
 * @param content Audio payload to write.
 */
function saveBinaryFile(fileName: string, content: Buffer): void {
    writeFile(fileName, content, 'utf8', (err) => {
        if (err) {
            log.error(`Error writing file ${fileName}`, {
                message: err.message,
                stack: err.stack,
            });
            return;
        }
        log.info(`File ${fileName} saved to file system.`);
    });
}

/**
 * Normalizes a relative URL into an absolute URL using the configured base.
 * @param rawUrl Relative or absolute URL part.
 * @param base Base URL to resolve against, defaults to cfg.BASE_URL.
 * @returns Absolute URL string.
 */
function normalizeUri(rawUrl: string, base = cfg.BASE_URL): string {
    return new URL(rawUrl, base).toString(); // base는 상대경로일 때만 필요
}

/**
 * Generates TTS audio for the given message and returns a public URL to the saved file.
 * Uses streaming responses to assemble the final audio buffer before writing to disk.
 * @param message Text content to synthesize.
 * @returns Absolute URL string for the generated audio, or empty string on failure.
 */
export async function createAudioTTS(message: string, temperature: number, styleTone: StyleTone, voiceActor: VoiceActor): Promise<string> {
    let fileURL = '';

    let conversionStyleTone: string = styleTone;
    // 'Hitomi' 스타일은 별도 처리
    switch (styleTone) {
        case StyleTone.Hitomi:
            conversionStyleTone = 'Read aloud in a breathlessly rising, as if lifting something overwhelmingly heavy tone:';
            break;
        case StyleTone.Normal:
            conversionStyleTone = '';
            break;
        default:
            conversionStyleTone = `Read aloud in ${styleTone} tone:`;
            break;
    }

    const genAI = getGenAI();
    if (!genAI) {
        log.info('Google GenAI client is not initialized.');
        return fileURL;
    }

    const config = {
        temperature: temperature,
        responseModalities: [
            'audio',
        ],
        speechConfig: {
            voiceConfig: {
                prebuiltVoiceConfig: {
                    voiceName: voiceActor,
                }
            }
        },
    };
    const model = cfg.AUDIO_MODEL;
    const contents = [
        {
            role: 'user',
            parts: [
                {
                    text: `${conversionStyleTone} ${message}`,
                },
            ],
        },
    ];

    const response = await genAI.models.generateContentStream({
        model,
        config,
        contents,
    });

    const filePath = crypto.randomUUID();
    const collectedBuffers: Buffer[] = [];
    let collectedMimeType = '';

    // 스트리밍 청크를 모두 모아서 한 번에 파일로 저장
    for await (const chunk of response) {
        if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
            continue;
        }
        if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
            const inlineData = chunk.candidates[0].content.parts[0].inlineData;
            collectedMimeType ||= inlineData.mimeType || '';
            const buffer = Buffer.from(inlineData.data || '', 'base64');
            collectedBuffers.push(buffer);
        }
        else {
            log.error('failed to get audio data from TTS response chunk');
        }
    }

    if (!collectedBuffers.length) {
        log.error('failed to collect audio data from TTS response');
        return fileURL;
    }

    const combinedBuffer = Buffer.concat(collectedBuffers);
    let fileExtension = mime.getExtension(collectedMimeType || '');
    let fileData: Buffer<ArrayBufferLike> = combinedBuffer;

    if (!fileExtension) {
        fileExtension = 'wav';
        fileData = convertToWav(combinedBuffer.toString('base64'), collectedMimeType || '');
    }

    const fileName = `${filePath}.${fileExtension}`;
    const audioDir = path.join(process.cwd(), cfg.FOUNDRY_DATA_PATH, cfg.AUDIO_OUTPUT_DIR);

    saveBinaryFile(`${audioDir}/${fileName}`, fileData);
    fileURL = cfg.FOUNDRY_DATA_PATH === ''
        ? normalizeUri(`${cfg.AUDIO_PATH}/${fileName}`)
        : path.join(cfg.AUDIO_OUTPUT_DIR, fileName);
    log.info(`Audio TTS file saved: ${fileURL}`);

    return fileURL;
}

interface WavConversionOptions {
    numChannels: number,
    sampleRate: number,
    bitsPerSample: number
}

/**
 * Converts raw audio (base64 PCM) into a WAV buffer using parsed mime metadata.
 * @param rawData Base64-encoded audio payload.
 * @param mimeType Mime type string containing format details (e.g., channels/rate).
 * @returns Buffer containing a complete WAV file.
 */
function convertToWav(rawData: string, mimeType: string): Buffer {
    const options = parseMimeType(mimeType)
    const buffer = Buffer.from(rawData, 'base64');
    const wavHeader = createWavHeader(buffer.length, options);

    return Buffer.concat([wavHeader, buffer]);
}

/**
 * Extracts WAV header options from a mime type string.
 * @param mimeType Mime type from the TTS response (e.g., audio/L16;rate=24000).
 * @returns Parsed channel, sample rate, and bit depth info.
 */
function parseMimeType(mimeType: string): WavConversionOptions {
    const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
    const [_, format] = fileType.split('/');

    const options: Partial<WavConversionOptions> = {
        numChannels: 1,
    };

    if (format && format.startsWith('L')) {
        const bits = parseInt(format.slice(1), 10);
        if (!isNaN(bits)) {
            options.bitsPerSample = bits;
        }
    }

    for (const param of params) {
        const [key, value] = param.split('=').map(s => s.trim());
        if (key === 'rate') {
            options.sampleRate = parseInt(value, 10);
        }
    }
    return options as WavConversionOptions;
}

/**
 * Builds a PCM WAV header matching the provided audio buffer.
 * @param dataLength Length of the raw PCM data in bytes.
 * @param options WAV format parameters such as channels, sample rate, and bit depth.
 * @returns Buffer containing a 44-byte WAV header.
 */
function createWavHeader(dataLength: number, options: WavConversionOptions): Buffer {
    const {
        numChannels,
        sampleRate,
        bitsPerSample,
    } = options;

    // http://soundfile.sapp.org/doc/WaveFormat

    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const buffer = Buffer.alloc(44);

    buffer.write('RIFF', 0);                      // ChunkID
    buffer.writeUInt32LE(36 + dataLength, 4);     // ChunkSize
    buffer.write('WAVE', 8);                      // Format
    buffer.write('fmt ', 12);                     // Subchunk1ID
    buffer.writeUInt32LE(16, 16);                 // Subchunk1Size (PCM)
    buffer.writeUInt16LE(1, 20);                  // AudioFormat (1 = PCM)
    buffer.writeUInt16LE(numChannels, 22);        // NumChannels
    buffer.writeUInt32LE(sampleRate, 24);         // SampleRate
    buffer.writeUInt32LE(byteRate, 28);           // ByteRate
    buffer.writeUInt16LE(blockAlign, 32);         // BlockAlign
    buffer.writeUInt16LE(bitsPerSample, 34);      // BitsPerSample
    buffer.write('data', 36);                     // Subchunk2ID
    buffer.writeUInt32LE(dataLength, 40);         // Subchunk2Size

    return buffer;
}

export async function createImageGen(message: string, temperature: number, convURL: boolean, aspectRatio?: AspectRatio): Promise<string> {
    let fileURL = '';
    let aspectRatio_lo: AspectRatio = aspectRatio ?? AspectRatio.R2_3;

    const genAI = getGenAI();
    if (!genAI) {
        log.warn('Image generation skipped: Google GenAI client not initialized.');
        return fileURL;
    }

    const config = {
        temperature: temperature,
        maxOutputTokens: 1290,
        topP: 0.95,
        responseModalities: [
            'IMAGE',
            // 'TEXT',
        ],
        imageConfig: {
            aspectRatio: `${aspectRatio_lo}`,
        },
        systemInstruction: [
            {
                text: `for TRPG Image`,
            }
        ],
    };
    const model = cfg.IMAGE_MODEL;
    const contents = [
        {
            role: 'user',
            parts: [
                {
                    text: `${message}`,
                },
            ],
        },
    ];

    let response;
    try {
        response = await genAI.models.generateContentStream({ model, config, contents });
    } catch (err) {
        log.error(`Image generation failed: ${err instanceof Error ? err.message : String(err)}`);
        return fileURL;
    }

    const filePath = crypto.randomUUID();
    const collectedBuffers: Buffer[] = [];
    let collectedMimeType = '';

    // 스트리밍 청크를 모두 모아서 한 번에 파일로 저장
    for await (const chunk of response) {
        if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
            continue;
        }
        if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
            const inlineData = chunk.candidates[0].content.parts[0].inlineData;
            collectedMimeType ||= inlineData.mimeType || '';
            const buffer = Buffer.from(inlineData.data || '', 'base64');
            collectedBuffers.push(buffer);
        }
        else {
            log.warn(`Image generation chunk text: ${chunk.text}`);
        }
    }

    if (!collectedBuffers.length) {
        log.error('Image generation failed: no image data collected from response.');
        return fileURL;
    }

    const combinedBuffer = Buffer.concat(collectedBuffers);
    let fileExtension = mime.getExtension(collectedMimeType || '');

    let fileData: Buffer<ArrayBufferLike> =
        await sharp(combinedBuffer)
            .ensureAlpha()
            .webp({
                quality: 85,
                alphaQuality: 100,
                smartSubsample: false,
                effort: 5,
                preset: 'picture',
            }).toBuffer();

    fileExtension = 'webp';

    const fileName = `${filePath}.${fileExtension}`;
    const imageDir = path.join(process.cwd(), cfg.FOUNDRY_DATA_PATH, cfg.IMAGE_OUTPUT_DIR);

    saveBinaryFile(`${imageDir}/${fileName}`, fileData);

    if (convURL) {
        fileURL = normalizeUri(`${cfg.IMAGE_PATH}/${fileName}`);
    } else {
        fileURL = cfg.FOUNDRY_DATA_PATH === ''
            ? normalizeUri(`${cfg.IMAGE_PATH}/${fileName}`)
            : path.join(cfg.IMAGE_OUTPUT_DIR, fileName);
    };
    log.info(`Image Gen file saved: ${fileURL}`);

    return fileURL;
}
