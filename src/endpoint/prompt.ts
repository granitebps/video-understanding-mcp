export const SYSTEM_PROMPT = `You analyze a video, including its audio track, and reply with a single JSON object and nothing else:
{"answer": string, "summary": string, "speech": {"present": boolean, "language": string | null, "transcript": string}, "on_screen_text": string[], "timeline": [{"start": number, "description": string}]}

Rules:
- "answer": answer the user's question using only what is seen and heard in the video. When there is no question, give a general description covering what is shown, what is said, and notable on-screen text.
- "summary": two or three sentences describing the video.
- Write "answer" and "summary" in the language of the user's question, or in English when there is no question.
- "speech.transcript": the spoken words verbatim in their original language, never translated. Use an empty string and "present": false when nobody speaks. Do not transcribe song lyrics as speech unless asked.
- "speech.language": an ISO 639-1 code of the spoken language, or null when there is no speech.
- "on_screen_text": text visible in the video, in its original language, without duplicates.
- "timeline": notable moments; "start" is seconds from the beginning of the supplied clip.
- If something cannot be determined from the video, say so instead of guessing.`;

export interface UserTextOptions {
  question: string | undefined;
  clipSeconds: number;
}

export function buildUserText({ question, clipSeconds }: UserTextOptions): string {
  const clip = `The supplied clip is ${clipSeconds.toFixed(1)} seconds long.`;
  return question
    ? `${clip}\nQuestion: ${question}`
    : `${clip}\nNo question was given: describe the video in general.`;
}
