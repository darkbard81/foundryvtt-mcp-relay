import { GoogleGenAI } from '@google/genai';
import mime from 'mime';
import { writeFile } from 'fs';
import crypto from 'crypto';
import { log } from '../utils/logger.js';
import { URL } from 'node:url';

function saveBinaryFile(fileName: string, content: Buffer) {
    writeFile(fileName, content, 'utf8', (err) => {
        if (err) {
            console.error(`Error writing file ${fileName}:`, err);
            return;
        }
        console.log(`File ${fileName} saved to file system.`);
    });
}

function normalizeUri(rawUrl: string, base = 'https://mcp.krdp.ddns.net') {
    return new URL(rawUrl, base).toString(); // base는 상대경로일 때만 필요
}

export async function createAudioTTS(message: string): Promise<string> {
    const genAI = new GoogleGenAI({
        apiKey: process.env.GOOGLE_GENAI_API_KEY || '',
        vertexai: true,
        // project: process.env.GOOGLE_GENAI_PROJECT_ID || '',
        // location: process.env.GOOGLE_GENAI_PROJECT_LOCATION || '',
    });

    const config = {
        temperature: 1,
        systemInstruction:
        {
            role: 'system',
            parts: [{ text: 'Pronounce breathy sounds like "aah", "mmh", "eung" naturally and softly. and sexy.' }],
        },
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
    let fileIndex = 0;

    const filePath = crypto.randomUUID();
    let fileURL: string = '';
    for await (const chunk of response) {
        if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
            continue;
        }
        if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
            const fileName = `${filePath}_${fileIndex++}`;
            const inlineData = chunk.candidates[0].content.parts[0].inlineData;
            let fileExtension = mime.getExtension(inlineData.mimeType || '');
            let buffer = Buffer.from(inlineData.data || '', 'base64');
            if (!fileExtension) {
                fileExtension = 'wav';
                buffer = convertToWav(inlineData.data || '', inlineData.mimeType || '');
            }
            saveBinaryFile(`tts_output/${fileName}.${fileExtension}`, buffer);
            fileURL = `tts/${fileName}.${fileExtension}`;
            fileURL = normalizeUri(fileURL);
            log.info(`Audio TTS file saved: ${fileURL}`);
        }
        else {
            log.info('failed to get audio data from TTS response chunk');
        }
    }
    return fileURL;
}

interface WavConversionOptions {
    numChannels: number,
    sampleRate: number,
    bitsPerSample: number
}

function convertToWav(rawData: string, mimeType: string) {
    const options = parseMimeType(mimeType)
    const wavHeader = createWavHeader(rawData.length, options);
    const buffer = Buffer.from(rawData, 'base64');

    return Buffer.concat([wavHeader, buffer]);
}

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