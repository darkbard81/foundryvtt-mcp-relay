import { GoogleGenAI } from '@google/genai';
import mime from 'mime';
import { writeFile } from 'fs';
import crypto from 'crypto';
import { log } from '../utils/logger.js';
import { URL } from 'node:url';
import { cfg } from '../config.js';

let client: GoogleGenAI | null = null;
/**
 * Returns a singleton GoogleGenAI client or null when the API key is missing.
 * Always checks the configured key before attempting initialization.
 */
export function getGenAI(): GoogleGenAI | null {
    if (!cfg.GOOGLE_GENAI_API_KEY) {
        return null;
    }
    if (!client) {
        try {
            client = new GoogleGenAI({ apiKey: cfg.GOOGLE_GENAI_API_KEY });
        } catch (err: unknown) {
            const meta = err instanceof Error
                ? { message: err.message, stack: err.stack }
                : { err };
            log.error('Failed to initialize GoogleGenAI client', meta);
            client = null;
        }
    }
    return client;
}

/**
 * Persists binary content to disk and logs success or failure.
 * @param fileName Relative path to save the file under `tts_output`.
 * @param content Audio payload to write.
 */
function saveBinaryFile(fileName: string, content: Buffer) {
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
 */
function normalizeUri(rawUrl: string, base = cfg.BASE_URL ): string {
    return new URL(rawUrl, base).toString(); // base는 상대경로일 때만 필요
}

/**
 * Generates TTS audio for the given message and returns a public URL to the saved file.
 * Uses streaming responses to assemble the final audio buffer before writing to disk.
 * @param message Text content to synthesize.
 * @returns Absolute URL string for the generated audio, or empty string on failure.
 */
export async function createAudioTTS(message: string): Promise<string> {
    let fileURL = '';

    const genAI = getGenAI();
    if (!genAI) {
        log.info('Google GenAI client is not initialized.');
        return fileURL;
    }

    const config = {
        temperature: 2,
        responseModalities: [
            'audio',
        ],
        speechConfig: {
            voiceConfig: {
                prebuiltVoiceConfig: {
                    voiceName: 'Achernar',
                }
            }
        },
    };
    const model = 'gemini-2.5-flash-preview-tts';
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
    let fileData = combinedBuffer;

    if (!fileExtension) {
        fileExtension = 'wav';
        fileData = convertToWav(combinedBuffer.toString('base64'), collectedMimeType || '');
    }

    const fileName = `${filePath}.${fileExtension}`;
    saveBinaryFile(`tts_output/${fileName}`, fileData);
    fileURL = normalizeUri(`tts/${fileName}`);
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
function convertToWav(rawData: string, mimeType: string) {
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
function parseMimeType(mimeType: string) {
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
function createWavHeader(dataLength: number, options: WavConversionOptions) {
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
