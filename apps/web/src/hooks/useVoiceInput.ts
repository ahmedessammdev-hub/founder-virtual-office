import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export type VoiceLocale = "ar-EG" | "en-US";

/**
 * Browser-native Arabic (Egyptian) & English Speech-to-Text dictation hook
 * with safe fallback when Web Speech API is unavailable.
 */
export function useVoiceInput(
  onFinalTranscript: (text: string) => void,
  initialLang: VoiceLocale = "ar-EG",
) {
  const ctor = getSpeechCtor();
  const supported = Boolean(ctor);
  const [listening, setListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState<VoiceLocale>(initialLang);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  const callbackRef = useRef(onFinalTranscript);
  callbackRef.current = onFinalTranscript;

  const stop = useCallback(() => {
    if (recRef.current) {
      try {
        recRef.current.stop();
      } catch {
        // Ignore already-stopped recognition
      }
      recRef.current = null;
    }
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (listening) {
      stop();
      return;
    }
    const Ctor = getSpeechCtor();
    if (!Ctor) {
      setError("Speech recognition unavailable in this browser.");
      return;
    }

    setError(null);
    const rec = new Ctor();
    rec.lang = voiceLang;
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (event) => {
      const pieces: string[] = [];
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        if (res?.isFinal && res[0]?.transcript) {
          pieces.push(res[0].transcript.trim());
        }
      }
      const combined = pieces.join(" ").trim();
      if (combined) {
        callbackRef.current(combined);
      }
    };

    rec.onerror = (ev) => {
      setError(ev.error ?? "Voice dictation error");
      setListening(false);
    };

    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start microphone");
      setListening(false);
      recRef.current = null;
    }
  }, [listening, stop, voiceLang]);

  useEffect(() => {
    return () => {
      if (recRef.current) {
        try {
          recRef.current.stop();
        } catch {
          // Ignore unmount cleanup error
        }
      }
    };
  }, []);

  return {
    supported,
    listening,
    voiceLang,
    setVoiceLang,
    toggle,
    stop,
    error,
  };
}
