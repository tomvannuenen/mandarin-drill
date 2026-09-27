// Record yourself, then hear yourself next to the native voice. Recordings stay in memory for the session.
let recorder = null;
let chunks = [];
let stream = null;

export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

function mimeType() {
  for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return '';
}

export async function startRecording() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const type = mimeType();
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start();
}

export function stopRecording() {
  return new Promise((resolve) => {
    if (!recorder) return resolve(null);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/mp4' });
      recorder = null;
      resolve(blob);
    };
    recorder.stop();
  });
}

export const isRecording = () => !!recorder;

// Plays the learner's recording, then the model audio.
export function compare(blob, modelSrc) {
  const mine = new Audio(URL.createObjectURL(blob));
  mine.onended = () => { URL.revokeObjectURL(mine.src); if (modelSrc) new Audio(modelSrc).play().catch(() => {}); };
  return mine.play().catch(() => {});
}

export async function share(blob, name) {
  const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
  const file = new File([blob], `${name}.${ext}`, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: name });
}
